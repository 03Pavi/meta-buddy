import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { MetaWearables, type MetaWearablesEvent } from '../../modules/meta-wearables/src';
import { GemmaProvider } from '../providers/ai/GemmaProvider';
import { buildLocalMessages } from '../providers/ai/promptBudget';
import { DeviceSpeechRecognition } from '../providers/speech/DeviceSpeechRecognition';
import { OfflineSpeechRecognition } from '../providers/speech/OfflineSpeechRecognition';
import { VOICE_MODELS, voiceModelPath } from '../services/speech/voiceModels';
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
export const ECHO_GUARD_MS = 700;
/** Safety net: if the speech engine never reports the end of playback, stop waiting after this long. */
const SPEECH_OUTPUT_FALLBACK_MS = 60_000;
const SPOKEN_LOCALE = 'en-US';
const MAX_REPLY_TOKENS = 220;
const NOT_TEXT_ONLY_NOTE = 'Gemma on this phone is text-only, so it cannot see the camera. Ask without the camera.';

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeMessage(role: TranscriptMessage['role'], text: string): TranscriptMessage {
  return { id: newId(), role, text, createdAt: Date.now() };
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
  const speechOutputRef = useRef<{ utteranceId: string; timer: ReturnType<typeof setTimeout> } | null>(null);
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

  // The offline model is used only when Models has the switch on. Otherwise the phone's recognizer is used.
  const activeSpeech = useCallback((): DeviceSpeechRecognition | OfflineSpeechRecognition => {
    if (!settingsRef.current.offlineSpeech) return speechRef.current;
    if (!offlineSpeechRef.current) {
      offlineSpeechRef.current = new OfflineSpeechRecognition(voiceModelPath(VOICE_MODELS[0]));
    }
    return offlineSpeechRef.current;
  }, []);
  const ttsRef = useRef(new DeviceTextToSpeech(SPOKEN_LOCALE));

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

  const speakReply = useCallback(
    (text: string) => {
      const spoken = settingsRef.current.spokenReplies ? toSpeechText(text) : '';
      if (!spoken) {
        dispatch({ type: 'phaseChanged', phase: 'idle' });
        scheduleListenAfterReply();
        return;
      }
      clearSpeechTimer();
      const utteranceId = newId();
      speechOutputRef.current = {
        utteranceId,
        timer: setTimeout(() => {
          clearSpeechTimer();
          dispatch({ type: 'phaseChanged', phase: 'idle' });
        }, SPEECH_OUTPUT_FALLBACK_MS),
      };
      dispatch({ type: 'phaseChanged', phase: 'speaking' });
      ttsRef.current.speak(spoken, {
        onDone: () => {
          if (speechOutputRef.current?.utteranceId !== utteranceId) return;
          clearSpeechTimer();
          dispatch({ type: 'phaseChanged', phase: 'idle' });
          scheduleListenAfterReply();
        },
        onError: (message) => {
          if (speechOutputRef.current?.utteranceId !== utteranceId) return;
          clearSpeechTimer();
          dispatch({ type: 'failed', message: `Spoken reply failed: ${message}` });
        },
      });
    },
    [clearSpeechTimer, scheduleListenAfterReply],
  );

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

  const runTurn = useCallback(
    async (text: string) => {
      if (inFlightRef.current || isBusy(stateRef.current.phase)) return;
      inFlightRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await stopSpeechInput();
        if (stateRef.current.phase === 'speaking') await stopSpeaking();
        clearReopenTimer();

        // Capture history before this turn's messages are added.
        const history = stateRef.current.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.text }));

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

        const messages = buildLocalMessages(history, text);
        const result = await gemma.generate({ messages, maxTokens: MAX_REPLY_TOKENS, signal: controller.signal });
        dispatch({
          type: 'requestFinished',
          requestId: text,
          conversationId: stateRef.current.conversationId ?? newId(),
          contextReset: false,
          reply: makeMessage('assistant', result.text),
        });
        speakReply(result.text);
      } catch (error) {
        if (controller.signal.aborted) {
          dispatch({ type: 'requestCancelled', requestId: text });
        } else {
          dispatch({ type: 'requestFailed', requestId: text, message: friendlyError(error) });
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        inFlightRef.current = false;
      }
    },
    [clearReopenTimer, getGemma, speakReply, stopSpeechInput, stopSpeaking],
  );

  const retry = useCallback(async () => {
    const text = stateRef.current.lastUserText;
    if (!text) return;
    dispatch({ type: 'errorCleared' });
    await runTurn(text);
  }, [runTurn]);

  // endregion

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
        onPartial: (partial) => dispatch({ type: 'draftChanged', draft: partial }),
        onFinal: (final) => {
          listeningSourceRef.current = null;
          dispatch({ type: 'draftChanged', draft: '' });
          runTurn(final);
        },
        onError: (code, message) => {
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
  }, [clearReopenTimer, runTurn]);

  startListeningRef.current = startListening;

  const stopListening = useCallback(async () => {
    dispatch({ type: 'draftChanged', draft: '' });
    await stopSpeechInput();
    if (stateRef.current.phase === 'listening') {
      dispatch({ type: 'phaseChanged', phase: 'idle' });
    }
  }, [stopSpeechInput]);

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
          handlersRef.current.runTurn(text.trim());
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
        gemmaRef.current?.release().catch(() => undefined);
        gemmaPathRef.current = null;
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
    chatIdRef.current = null;
    setCurrentChatId(null);
    dispatch({ type: 'conversationCleared' });
  }, [stopAll]);

  const openChat = useCallback(
    async (id: string) => {
      await stopAll();
      const messages = await loadChat(id);
      chatIdRef.current = id;
      setCurrentChatId(id);
      openingChatRef.current = true;
      dispatch({ type: 'transcriptLoaded', messages });
    },
    [stopAll],
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
    const id = chatIdRef.current;
    chatIdRef.current = null;
    setCurrentChatId(null);
    dispatch({ type: 'conversationCleared' });
    if (id) {
      await deleteChat(id);
      await refreshChats();
    }
  }, [stopAll, refreshChats]);

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
      newChat,
      openChat,
      removeChat,
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
