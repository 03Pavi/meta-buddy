import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { MetaWearables, type MetaWearablesEvent } from '../../modules/meta-wearables/src';
import { GemmaProvider } from '../providers/ai/GemmaProvider';
import type { ChatMessage } from '../providers/types';
import { buildLocalMessages, buildSummaryMessages, RECENT_TURNS, SUMMARY_TOKENS } from '../providers/ai/promptBudget';
import { DeviceSpeechRecognition } from '../providers/speech/DeviceSpeechRecognition';
import { OfflineSpeechRecognition } from '../providers/speech/OfflineSpeechRecognition';
import { findVoiceModel, voiceModelPath } from '../services/speech/voiceModels';
import { DeviceTextToSpeech } from '../providers/speech/DeviceTextToSpeech';
import { toSpeechText } from '../providers/speech/toSpeechText';
import { findModel } from '../services/models/catalog';
import { checkModelFile, resolveModelPath } from '../services/models/modelFile';
import { needsVisualContext } from '../features/assistant/intent';
import {
  assistantReducer,
  initialAssistantState,
  isBusy,
  type AssistantState,
  type TranscriptMessage,
} from '../features/assistant/assistantState';
import {
  deleteChat,
  listChats,
  loadChat,
  saveChat,
  type ChatSummary,
} from '../services/storage/chatStore';
import { useSettings } from './SettingsProvider';

export interface AssistantActions {
  sendText: (text: string) => Promise<void>;
  retry: () => Promise<void>;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  setVoiceMode: (enabled: boolean) => Promise<void>;
  stopSpeaking: () => Promise<void>;
  stopAll: () => Promise<void>;
  clearConversation: () => Promise<void>;
  clearError: () => void;
  /** Asks the model to carry on from the end of the last reply. */
  continueReply: () => Promise<void>;
  /** Speaks into the text box: partial and final words go to the caller. Nothing is sent by itself. */
  dictateStart: (handlers: {
    onPartial: (text: string) => void;
    onFinal: (text: string) => void;
    onError: (message: string) => void;
    onEnd: () => void;
  }) => Promise<void>;
  dictateStop: () => Promise<void>;
  newChat: () => Promise<void>;
  openChat: (id: string) => Promise<void>;
  removeChat: (id: string) => Promise<void>;
}

interface AssistantContextValue {
  state: AssistantState;
  actions: AssistantActions;
  /** Saved chats, most recent first. Empty when Keep conversation history is off. */
  chats: ChatSummary[];
  currentChatId: string | null;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

/** Silence after a reply before the microphone reopens, so the assistant does not hear its own voice. */
export const ECHO_GUARD_MS = 1500;
/** Safety net: if the speech engine never reports the end of playback, stop waiting after this long. */
const SPEECH_OUTPUT_FALLBACK_MS = 60_000;
const SPOKEN_LOCALE = 'en-US';
/** Silence after the last spoken word that counts as the user having stopped talking. */
const END_OF_SPEECH_MS = 1200;
const MAX_REPLY_TOKENS = 220;
const NOT_TEXT_ONLY_NOTE = 'Gemma on this phone is text-only, so it cannot see the camera. Ask without the camera.';

/** The user and assistant turns of a transcript, in the form the model reads. System notes are left out. */
function dialogOf(messages: { role: string; text: string }[]): ChatMessage[] {
  return messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.text }));
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeMessage(role: TranscriptMessage['role'], text: string): TranscriptMessage {
  return { id: newId(), role, text, createdAt: Date.now() };
}

/**
 * True when recognized text is mostly the words of a reply. That means the microphone heard the speaker, not the user.
 */
function isEchoOfReply(heard: string, reply: string): boolean {
  const words = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  const heardWords = words(heard);
  if (heardWords.length === 0) return false;
  const replyWords = new Set(words(reply));
  const matched = heardWords.filter(word => replyWords.has(word)).length;
  return matched / heardWords.length >= 0.6;
}

/** Joins a continued reply to the text before it, so a word cut at the limit is not split by a space. */
function joinText(previous: string, addition: string): string {
  const next = addition.replace(/^\s+/, '');
  if (!next) return previous;
  if (/\s$/.test(previous)) return previous + next;
  if (/[A-Za-z]$/.test(previous) && /^[a-z]/.test(next)) return previous + next;
  return `${previous} ${next}`;
}

function friendlyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

/**
 * Runs the conversation entirely on the phone: speech in, Gemma 3 1B for the reply, and speech out.
 * In voice mode it listens again after each reply. No server is contacted.
 *
 * Handlers that run from native or speech events read the latest state through refs, so each subscription
 * is created once and never goes stale.
 */
export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const [state, dispatch] = useReducer(assistantReducer, initialAssistantState);

  const stateRef = useRef(state);
  stateRef.current = state;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Synchronous guard against double submission. React state updates are too slow to rely on for this.
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // Rolling summary of the older turns. The model sees it instead of the full text of those turns.
  const summaryRef = useRef('');
  const summarizedCountRef = useRef(0);
  const summaryAbortRef = useRef<AbortController | null>(null);
  const summaryPromiseRef = useRef<Promise<void> | null>(null);
  const speechOutputRef = useRef<{ utteranceId: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  // The reply being spoken as it is written: how much of it has been queued, and whether speech has started.
  const speechStreamRef = useRef<{ utteranceId: string; index: number; spoken: boolean } | null>(null);
  const endOfSpeechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the current or last question was asked by voice. Only voice questions get spoken replies.
  const lastTurnVoiceRef = useRef(false);
  const reopenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listeningSourceRef = useRef<'glasses' | 'phone' | null>(null);
  const transcriptLoadedRef = useRef(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const chatIdRef = useRef<string | null>(null);
  // Set while an opened chat is loaded, so loading it is not saved again as a change.
  const openingChatRef = useRef(false);

  const speechRef = useRef(new DeviceSpeechRecognition());
  const offlineSpeechRef = useRef<OfflineSpeechRecognition | null>(null);
  const offlineSpeechPathRef = useRef<string | null>(null);

  // The offline model is used only when Models has the switch on. Otherwise the phone's recognizer is used.
  // The engine follows the speech model chosen in Models, so switching models takes effect at the next listen.
  const activeSpeech = useCallback((): DeviceSpeechRecognition | OfflineSpeechRecognition => {
    if (!settingsRef.current.offlineSpeech) return speechRef.current;
    const path = voiceModelPath(findVoiceModel(settingsRef.current.speechModelId));
    if (!offlineSpeechRef.current || offlineSpeechPathRef.current !== path) {
      offlineSpeechRef.current?.destroy();
      offlineSpeechRef.current = new OfflineSpeechRecognition(path);
      offlineSpeechPathRef.current = path;
    }
    return offlineSpeechRef.current;
  }, []);
  const ttsRef = useRef(new DeviceTextToSpeech(SPOKEN_LOCALE, () => settingsRef.current.speechRate));

  // The on-device model is recreated only when its file path changes. Loading happens on first use.
  const gemmaRef = useRef<GemmaProvider | null>(null);
  const gemmaPathRef = useRef<string | null>(null);
  const getGemma = useCallback(async (): Promise<GemmaProvider> => {
    const model = findModel(settingsRef.current.modelId);
    const path = resolveModelPath(settingsRef.current.modelPath, model);
    if (!gemmaRef.current || gemmaPathRef.current !== path) {
      await gemmaRef.current?.release();
      gemmaRef.current = new GemmaProvider(path, model.label);
      gemmaPathRef.current = path;
    }
    return gemmaRef.current;
  }, []);

  // Saved chats, only when enabled in Settings.
  const refreshChats = useCallback(() => listChats().then(setChats), []);

  // On launch the most recent chat is reopened, as before.
  useEffect(() => {
    if (!settings.keepHistory || transcriptLoadedRef.current) return;
    transcriptLoadedRef.current = true;
    listChats().then(async (list) => {
      setChats(list);
      if (list.length === 0) return;
      const messages = await loadChat(list[0].id);
      if (messages.length === 0) return;
      openingChatRef.current = true;
      summaryRef.current = '';
      summarizedCountRef.current = 0;
      chatIdRef.current = list[0].id;
      setCurrentChatId(list[0].id);
      dispatch({ type: 'transcriptLoaded', messages });
    });
  }, [settings.keepHistory]);

  // Each chat is saved under one id as its messages change.
  useEffect(() => {
    if (openingChatRef.current) {
      openingChatRef.current = false;
      return;
    }
    if (!settings.keepHistory || state.messages.length === 0) return;
    const id = chatIdRef.current ?? newId();
    chatIdRef.current = id;
    setCurrentChatId(id);
    saveChat(id, state.messages).then(refreshChats);
  }, [settings.keepHistory, state.messages, refreshChats]);

  // region Speech output

  const clearSpeechTimer = useCallback(() => {
    if (speechOutputRef.current) {
      clearTimeout(speechOutputRef.current.timer);
      speechOutputRef.current = null;
    }
  }, []);

  const clearReopenTimer = useCallback(() => {
    if (reopenTimerRef.current) {
      clearTimeout(reopenTimerRef.current);
      reopenTimerRef.current = null;
    }
  }, []);

  const stopSpeaking = useCallback(async () => {
    clearSpeechTimer();
    clearReopenTimer();
    await ttsRef.current.stop();
    if (stateRef.current.phase === 'speaking') {
      dispatch({ type: 'phaseChanged', phase: 'idle' });
    }
  }, [clearReopenTimer, clearSpeechTimer]);

  const startListeningRef = useRef<() => Promise<void>>(async () => undefined);

  /** In voice mode, reopen the microphone after the reply has finished and the echo guard has passed. */
  const scheduleListenAfterReply = useCallback(() => {
    clearReopenTimer();
    if (!settingsRef.current.voiceMode || settingsRef.current.speechInput === 'text') return;
    reopenTimerRef.current = setTimeout(() => {
      reopenTimerRef.current = null;
      if (stateRef.current.phase === 'idle' && settingsRef.current.voiceMode) {
        startListeningRef.current();
      }
    }, ECHO_GUARD_MS);
  }, [clearReopenTimer]);

  /**
   * Starts speaking a reply as it is written. Each sentence is queued as soon as the model finishes it, so speech
   * begins before the whole reply is ready.
   */
  const startSpeechStream = useCallback(() => {
    if (!settingsRef.current.spokenReplies) {
      speechStreamRef.current = null;
      return;
    }
    clearSpeechTimer();
    const utteranceId = newId();
    speechStreamRef.current = { utteranceId, index: 0, spoken: false };
    speechOutputRef.current = {
      utteranceId,
      timer: setTimeout(() => {
        clearSpeechTimer();
        dispatch({ type: 'phaseChanged', phase: 'idle' });
      }, SPEECH_OUTPUT_FALLBACK_MS),
    };
    ttsRef.current.beginStream({
      onDone: () => {
        if (speechStreamRef.current?.utteranceId !== utteranceId) return;
        speechStreamRef.current = null;
        clearSpeechTimer();
        dispatch({ type: 'phaseChanged', phase: 'idle' });
        scheduleListenAfterReply();
      },
      onError: (message) => {
        if (speechStreamRef.current?.utteranceId !== utteranceId) return;
        speechStreamRef.current = null;
        clearSpeechTimer();
        dispatch({ type: 'failed', message: `Spoken reply failed: ${message}` });
      },
    });
  }, [clearSpeechTimer, scheduleListenAfterReply]);

  /**
   * Queues the sentences of the reply that are complete. `raw` is the whole reply so far. Text after the last
   * sentence end waits for more, unless `final` is set, which speaks whatever is left.
   */
  const feedSpeech = useCallback((raw: string, final: boolean) => {
    const session = speechStreamRef.current;
    if (!session) return;
    const rest = raw.slice(session.index);
    let cut = final ? rest.length : 0;
    // Wait for a code block to close, so code is not split into sentences and read out.
    const insideCode = (raw.match(/```/g) ?? []).length % 2 === 1;
    if (!final && insideCode) return;
    if (!final) {
      const sentence = /^[\s\S]*(?:[.!?।](?=\s|$)|\n)/.exec(rest);
      cut = sentence ? sentence[0].length : 0;
    }
    if (cut <= 0) return;
    session.index += cut;
    const chunk = toSpeechText(rest.slice(0, cut)).trim();
    if (!chunk) return;
    if (!session.spoken) {
      session.spoken = true;
      dispatch({ type: 'phaseChanged', phase: 'speaking' });
    }
    // Stop listening while Buddy speaks, so the microphone does not record the reply.
    activeSpeech().stop().catch(() => undefined);
    ttsRef.current.speakChunk(chunk);
  }, [activeSpeech]);

  // endregion

  // region Speech input

  const stopSpeechInput = useCallback(async () => {
    clearReopenTimer();
    const source = listeningSourceRef.current;
    listeningSourceRef.current = null;
    try {
      if (source === 'glasses') await MetaWearables.stopGlassesSpeech();
      if (source === 'phone') await activeSpeech().stop();
    } catch {
      // Best effort. The caller still resets the UI.
    }
  }, [clearReopenTimer]);

  // endregion

  // region Conversation turn

  const resetSummary = useCallback(() => {
    summaryRef.current = '';
    summarizedCountRef.current = 0;
  }, []);

  /**
   * Folds the older turns that are not yet summarized into the rolling summary, keeping the most recent turns
   * word for word. Runs after a reply, when the phone is idle. A new question stops it first.
   */
  const summarizeOlderTurns = useCallback(async () => {
    const dialog = dialogOf(stateRef.current.messages);
    const end = dialog.length - RECENT_TURNS;
    if (end <= summarizedCountRef.current) return;
    if (inFlightRef.current || isBusy(stateRef.current.phase)) return;

    const older = dialog.slice(summarizedCountRef.current, end);
    inFlightRef.current = true;
    const controller = new AbortController();
    summaryAbortRef.current = controller;
    const run = (async () => {
      try {
        const gemma = await getGemma();
        const result = await gemma.generate({
          messages: buildSummaryMessages(summaryRef.current, older),
          maxTokens: SUMMARY_TOKENS,
          signal: controller.signal,
        });
        if (!controller.signal.aborted && result.text.trim()) {
          summaryRef.current = result.text.trim();
          summarizedCountRef.current = end;
        }
      } catch {
        // Keep the previous summary. The older turns are summarized again next time.
      } finally {
        if (summaryAbortRef.current === controller) summaryAbortRef.current = null;
        inFlightRef.current = false;
      }
    })();
    summaryPromiseRef.current = run;
    await run;
    summaryPromiseRef.current = null;
  }, [getGemma]);

  const runTurn = useCallback(
    async (text: string, fromVoice = false) => {
      // A summary in progress yields to the question, so it is stopped and finished before the turn starts.
      if (summaryPromiseRef.current) {
        summaryAbortRef.current?.abort();
        await summaryPromiseRef.current;
      }
      if (inFlightRef.current || isBusy(stateRef.current.phase)) return;
      inFlightRef.current = true;
      lastTurnVoiceRef.current = fromVoice;
      const controller = new AbortController();
      abortRef.current = controller;
      let answered = false;

      try {
        await stopSpeechInput();
        if (stateRef.current.phase === 'speaking') await stopSpeaking();
        clearReopenTimer();

        // Capture history before this turn's messages are added. Turns already in the summary are left out.
        const history = dialogOf(stateRef.current.messages).slice(summarizedCountRef.current);

        dispatch({ type: 'messageAdded', message: makeMessage('user', text) });
        dispatch({ type: 'requestStarted', requestId: text, withImage: false, text });
        if (needsVisualContext(text)) {
          dispatch({ type: 'messageAdded', message: makeMessage('system', NOT_TEXT_ONLY_NOTE) });
        }

        const check = await checkModelFile(settingsRef.current.modelPath, findModel(settingsRef.current.modelId));
        if (!check.valid) {
          throw new Error(check.problem ?? 'The model file is not available.');
        }
        const gemma = await getGemma();
        await gemma.prepare((fraction) => dispatch({ type: 'loadProgressChanged', fraction }));
        dispatch({ type: 'loadProgressChanged', fraction: undefined });

        const messages = buildLocalMessages(history, text, undefined, undefined, summaryRef.current);
        // Only a question asked by voice gets a spoken reply. Typed questions get text only.
        if (fromVoice) startSpeechStream();
        const result = await gemma.generate({
          messages,
          maxTokens: MAX_REPLY_TOKENS,
          signal: controller.signal,
          // Each piece of the reply goes to the chat, and each finished sentence starts speaking.
          onPartial: (partial) => {
            dispatch({ type: 'streamChunk', text: partial });
            feedSpeech(partial, false);
          },
        });
        dispatch({
          type: 'requestFinished',
          requestId: text,
          conversationId: stateRef.current.conversationId ?? newId(),
          contextReset: false,
          reply: { ...makeMessage('assistant', result.text), truncated: result.truncated },
        });
        feedSpeech(result.text, true);
        if (speechStreamRef.current) {
          ttsRef.current.endStream();
        } else {
          dispatch({ type: 'phaseChanged', phase: 'idle' });
          scheduleListenAfterReply();
        }
        answered = true;
      } catch (error) {
        speechStreamRef.current = null;
        if (controller.signal.aborted) {
          dispatch({ type: 'requestCancelled', requestId: text });
        } else {
          dispatch({ type: 'requestFailed', requestId: text, message: friendlyError(error) });
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        inFlightRef.current = false;
        if (answered) void summarizeOlderTurns();
      }
    },
    [clearReopenTimer, feedSpeech, getGemma, scheduleListenAfterReply, startSpeechStream, stopSpeechInput, stopSpeaking, summarizeOlderTurns],
  );

  const retry = useCallback(async () => {
    const text = stateRef.current.lastUserText;
    if (!text) return;
    dispatch({ type: 'errorCleared' });
    await runTurn(text, lastTurnVoiceRef.current);
  }, [runTurn]);

  /**
   * Carries on a reply that stopped at the length limit. The new text is added to the same reply bubble, and the
   * model is given the reply so far, so it continues from the end instead of starting again.
   */
  const continueReply = useCallback(async () => {
    if (inFlightRef.current || isBusy(stateRef.current.phase)) return;
    const messages = stateRef.current.messages;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || !last.truncated) return;

    inFlightRef.current = true;
    clearReopenTimer();
    const controller = new AbortController();
    abortRef.current = controller;
    const previous = last.text;
    const history: ChatMessage[] = messages
      .filter(message => message.role !== 'system')
      .map(message => ({ role: message.role as 'user' | 'assistant', content: message.text }));
    const instruction = 'Continue the reply exactly where it stopped. Do not repeat anything already written.';

    try {
      dispatch({ type: 'phaseChanged', phase: 'processing' });
      const gemma = await getGemma();
      await gemma.prepare((fraction) => dispatch({ type: 'loadProgressChanged', fraction }));
      dispatch({ type: 'loadProgressChanged', fraction: undefined });
      if (lastTurnVoiceRef.current) startSpeechStream();
      const result = await gemma.generate({
        messages: buildLocalMessages(history, instruction),
        maxTokens: MAX_REPLY_TOKENS,
        signal: controller.signal,
        onPartial: (partial) => {
          dispatch({ type: 'replyExtended', id: last.id, text: joinText(previous, partial), truncated: true });
          feedSpeech(partial, false);
        },
      });
      dispatch({
        type: 'replyExtended',
        id: last.id,
        text: joinText(previous, result.text),
        truncated: Boolean(result.truncated),
      });
      feedSpeech(result.text, true);
      if (speechStreamRef.current) {
        ttsRef.current.endStream();
      } else {
        dispatch({ type: 'phaseChanged', phase: 'idle' });
        scheduleListenAfterReply();
      }
    } catch (error) {
      speechStreamRef.current = null;
      if (controller.signal.aborted) {
        dispatch({ type: 'phaseChanged', phase: 'idle' });
      } else {
        dispatch({ type: 'failed', message: friendlyError(error) });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      inFlightRef.current = false;
    }
  }, [clearReopenTimer, feedSpeech, getGemma, scheduleListenAfterReply, startSpeechStream]);

  // endregion

  /**
   * End-of-speech detection. While the user talks, the recognizer keeps producing new words. When no new words
   * arrive for END_OF_SPEECH_MS, the user has stopped, so listening ends and the turn is sent.
   */
  const clearEndOfSpeech = useCallback(() => {
    if (endOfSpeechTimerRef.current) {
      clearTimeout(endOfSpeechTimerRef.current);
      endOfSpeechTimerRef.current = null;
    }
  }, []);

  const armEndOfSpeech = useCallback(
    (partial: string) => {
      clearEndOfSpeech();
      if (!partial.trim()) return;
      endOfSpeechTimerRef.current = setTimeout(() => {
        endOfSpeechTimerRef.current = null;
        activeSpeech().stop();
      }, END_OF_SPEECH_MS);
    },
    [activeSpeech, clearEndOfSpeech],
  );

  const startListening = useCallback(async () => {
    if (inFlightRef.current || isBusy(stateRef.current.phase) || stateRef.current.phase === 'speaking') return;
    clearReopenTimer();
    const source = settingsRef.current.speechInput;
    if (source === 'text') {
      dispatch({ type: 'failed', message: 'Speech input is off. Choose phone or glasses speech in Settings.' });
      return;
    }
    try {
      if (source === 'glasses') {
        if (!MetaWearables.available) {
          dispatch({ type: 'failed', message: 'Glasses speech needs the Android development build.' });
          return;
        }
        // Glasses speech is a dev/beta SDK capability. The session must already be connected.
        await MetaWearables.startGlassesSpeech();
        listeningSourceRef.current = 'glasses';
        dispatch({ type: 'phaseChanged', phase: 'listening' });
        return;
      }

      // Phone speech: the microphone is requested only when the user asks to listen.
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          dispatch({ type: 'failed', message: 'Microphone permission is needed for voice input.' });
          return;
        }
      }
      const speech = activeSpeech();
      if (!(await speech.isAvailable())) {
        dispatch({ type: 'failed', message: 'Speech recognition is not available on this device.' });
        return;
      }
      listeningSourceRef.current = 'phone';
      dispatch({ type: 'phaseChanged', phase: 'listening' });
      await speech.start(SPOKEN_LOCALE, {
        onPartial: (partial) => {
          dispatch({ type: 'draftChanged', draft: partial });
          armEndOfSpeech(partial);
        },
        onFinal: (final) => {
          clearEndOfSpeech();
          listeningSourceRef.current = null;
          dispatch({ type: 'draftChanged', draft: '' });
          // The microphone can pick up Buddy's own voice. Text that matches the reply just spoken is ignored.
          const lastReply = [...stateRef.current.messages].reverse().find(message => message.role === 'assistant');
          if (lastReply && isEchoOfReply(final, lastReply.text)) {
            dispatch({ type: 'phaseChanged', phase: 'idle' });
            scheduleListenAfterReply();
            return;
          }
          runTurn(final, true);
        },
        onError: (code, message) => {
          clearEndOfSpeech();
          listeningSourceRef.current = null;
          dispatch({ type: 'draftChanged', draft: '' });
          // A silent turn returns to idle. It never restarts the microphone on its own.
          if (code === 'no_speech') {
            dispatch({ type: 'phaseChanged', phase: 'idle' });
          } else {
            dispatch({ type: 'failed', message });
          }
        },
        onEnd: () => {
          // A final result starts a turn, which owns the phase from here. Only reset when nothing else is running.
          if (!inFlightRef.current && listeningSourceRef.current === null && stateRef.current.phase === 'listening') {
            dispatch({ type: 'phaseChanged', phase: 'idle' });
          }
        },
      });
    } catch (error) {
      listeningSourceRef.current = null;
      dispatch({ type: 'failed', message: friendlyError(error) });
    }
  }, [armEndOfSpeech, clearEndOfSpeech, clearReopenTimer, runTurn, scheduleListenAfterReply]);

  startListeningRef.current = startListening;

  const stopListening = useCallback(async () => {
    clearEndOfSpeech();
    dispatch({ type: 'draftChanged', draft: '' });
    await stopSpeechInput();
    if (stateRef.current.phase === 'listening') {
      dispatch({ type: 'phaseChanged', phase: 'idle' });
    }
  }, [clearEndOfSpeech, stopSpeechInput]);

  /** Listens and passes the words to the caller, to write into the text box. Nothing is sent. */
  const dictateStart = useCallback(
    async (handlers: {
      onPartial: (text: string) => void;
      onFinal: (text: string) => void;
      onError: (message: string) => void;
      onEnd: () => void;
    }) => {
      if (inFlightRef.current || isBusy(stateRef.current.phase)) {
        handlers.onError('Wait for the reply to finish, then speak.');
        return;
      }
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          handlers.onError('Microphone permission is needed for voice input.');
          return;
        }
      }
      const speech = activeSpeech();
      if (!(await speech.isAvailable())) {
        handlers.onError('Speech recognition is not available on this device.');
        return;
      }
      await speech.start(SPOKEN_LOCALE, {
        onPartial: handlers.onPartial,
        onFinal: handlers.onFinal,
        onError: (_code, message) => handlers.onError(message),
        onEnd: handlers.onEnd,
      });
    },
    [activeSpeech],
  );

  const dictateStop = useCallback(async () => {
    await activeSpeech().stop();
  }, [activeSpeech]);

  const setVoiceMode = useCallback(
    async (enabled: boolean) => {
      // Enabling voice mode is the consent step. Settings are updated by the screen.
      if (enabled && settingsRef.current.speechInput === 'text') {
        dispatch({ type: 'failed', message: 'Voice mode needs phone or glasses speech. Choose one in Settings.' });
        return;
      }
      if (!enabled) {
        clearReopenTimer();
        await stopSpeechInput();
        if (stateRef.current.phase === 'listening') dispatch({ type: 'phaseChanged', phase: 'idle' });
        return;
      }
      if (stateRef.current.phase === 'idle') {
        await startListening();
      }
    },
    [clearReopenTimer, startListening, stopSpeechInput],
  );

  // endregion

  // region Native events (glasses speech and hands-free invocation)

  const handlersRef = useRef({ runTurn, startListening });
  handlersRef.current = { runTurn, startListening };

  useEffect(() => {
    return MetaWearables.subscribe((event: MetaWearablesEvent) => {
      if (event.type === 'speechResult') {
        const { text, isFinal } = event.result;
        if (!isFinal) {
          dispatch({ type: 'draftChanged', draft: text });
          return;
        }
        const source = listeningSourceRef.current;
        listeningSourceRef.current = null;
        dispatch({ type: 'draftChanged', draft: '' });
        if (source === 'glasses') MetaWearables.stopGlassesSpeech().catch(() => undefined);
        if (text.trim()) {
          handlersRef.current.runTurn(text.trim(), true);
        } else {
          dispatch({ type: 'phaseChanged', phase: 'idle' });
        }
      }
      if (event.type === 'voiceInvocation') {
        // Acknowledge straight away so the glasses are not left waiting, then start listening.
        MetaWearables.respondToInvocation(event.invocation.requestId, true, 'listening').catch(() => undefined);
        handlersRef.current.startListening();
      }
    });
  }, []);

  // endregion

  // Going to the background stops the turn, listening and speaking, and frees the model's memory.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'background') {
        abortRef.current?.abort();
        gemmaRef.current?.cancel().catch(() => undefined);
        stopSpeechInput();
        stopSpeaking();
        // The model stays loaded, so the next reply does not wait for it to load again.
        dispatch({ type: 'phaseChanged', phase: 'idle' });
      }
    });
    return () => subscription.remove();
  }, [stopSpeaking, stopSpeechInput]);

  // Release the speech engine and timers when the provider unmounts.
  useEffect(() => {
    const speech = speechRef.current;
    return () => {
      speech.destroy();
      offlineSpeechRef.current?.destroy();
      clearSpeechTimer();
      clearReopenTimer();
    };
  }, [clearReopenTimer, clearSpeechTimer]);

  const stopAll = useCallback(async () => {
    clearReopenTimer();
    abortRef.current?.abort();
    await gemmaRef.current?.cancel().catch(() => undefined);
    await stopSpeechInput();
    await stopSpeaking();
    dispatch({ type: 'phaseChanged', phase: 'idle' });
  }, [clearReopenTimer, stopSpeaking, stopSpeechInput]);

  const newChat = useCallback(async () => {
    await stopAll();
    resetSummary();
    chatIdRef.current = null;
    setCurrentChatId(null);
    dispatch({ type: 'conversationCleared' });
  }, [stopAll, resetSummary]);

  const openChat = useCallback(
    async (id: string) => {
      await stopAll();
      resetSummary();
      const messages = await loadChat(id);
      chatIdRef.current = id;
      setCurrentChatId(id);
      openingChatRef.current = true;
      dispatch({ type: 'transcriptLoaded', messages });
    },
    [stopAll, resetSummary],
  );

  const removeChat = useCallback(
    async (id: string) => {
      await deleteChat(id);
      if (chatIdRef.current === id) await newChat();
      await refreshChats();
    },
    [newChat, refreshChats],
  );

  // Clear empties the open chat and removes it from the saved list.
  const clearConversation = useCallback(async () => {
    await stopAll();
    resetSummary();
    const id = chatIdRef.current;
    chatIdRef.current = null;
    setCurrentChatId(null);
    dispatch({ type: 'conversationCleared' });
    if (id) {
      await deleteChat(id);
      await refreshChats();
    }
  }, [stopAll, refreshChats, resetSummary]);

  const actions = useMemo<AssistantActions>(
    () => ({
      sendText: (text: string) => {
        const trimmed = text.trim();
        return trimmed ? runTurn(trimmed) : Promise.resolve();
      },
      retry,
      startListening,
      stopListening,
      setVoiceMode,
      stopSpeaking,
      stopAll,
      clearConversation,
      clearError: () => dispatch({ type: 'errorCleared' }),
      continueReply,
      dictateStart,
      dictateStop,
      newChat,
      openChat,
      removeChat,
    }),
    [
      retry,
      runTurn,
      startListening,
      stopListening,
      setVoiceMode,
      stopSpeaking,
      stopAll,
      clearConversation,
      continueReply,
      newChat,
      openChat,
      removeChat,
      dictateStart,
      dictateStop,
    ],
  );

  const value = useMemo(
    () => ({ state, actions, chats, currentChatId }),
    [state, actions, chats, currentChatId],
  );
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantContextValue {
  const context = useContext(AssistantContext);
  if (!context) throw new Error('useAssistant must be used inside AssistantProvider');
  return context;
}
