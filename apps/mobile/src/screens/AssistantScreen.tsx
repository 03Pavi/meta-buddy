import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/AppText';
import * as Clipboard from 'expo-clipboard';
import Markdown from 'react-native-markdown-display';
import { Notice, StatusPill } from '../components/ui';
import { fonts, radius, spacing, usePalette } from '../components/theme';
import {
  isBusy,
  type AssistantPhase,
  type TranscriptMessage,
} from '../features/assistant/assistantState';
import { connectionSummary } from '../features/glasses/glassesState';
import type { ChatSummary } from '../services/storage/chatStore';
import { useChatModelReady } from '../hooks/useChatModelReady';
import { findModel } from '../services/models/catalog';
import { useAssistant } from '../state/AssistantProvider';
import { useGlasses } from '../state/GlassesProvider';
import { useSettings } from '../state/SettingsProvider';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Assistant'>;

const PHASE_LABEL: Record<AssistantPhase, string> = {
  idle: 'Ready',
  listening: 'Listening…',
  processing: 'Thinking…',
  capturing: 'Capturing a photo…',
  speaking: 'Speaking…',
  error: 'Something went wrong',
};

const CONNECTION_LABEL = {
  unavailable: 'Glasses unavailable',
  not_registered: 'Glasses not registered',
  no_device: 'No glasses nearby',
  idle: 'Glasses ready',
  connecting: 'Connecting…',
  connected: 'Glasses connected',
} as const;

const CONNECTION_TONE = {
  unavailable: 'neutral',
  not_registered: 'warning',
  no_device: 'warning',
  idle: 'neutral',
  connecting: 'accent',
  connected: 'success',
} as const;

/** Starting prompts shown on an empty chat. Tapping one sends it. */
const SUGGESTIONS = [
  { label: 'Explain a topic simply', mark: 'E' },
  { label: 'Help me plan my day', mark: 'P' },
  { label: 'Write a short, polite message', mark: 'W' },
];

export function AssistantScreen({ navigation }: Props) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { state, actions, chats, currentChatId, attachedImage } = useAssistant();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  // Whether the chat is showing the newest text. When it is not, a button brings the reader back.
  const [atBottom, setAtBottom] = useState(true);

  const jumpToEnd = () => {
    listRef.current?.scrollToEnd({ animated: true });
    setAtBottom(true);
  };

  // While a reply is written, the view follows the new text, unless the reader has scrolled up.
  useEffect(() => {
    if (atBottom && state.streamText) listRef.current?.scrollToEnd({ animated: false });
    // Only the streamed text drives this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.streamText]);

  const { state: glasses } = useGlasses();
  const { settings, update } = useSettings();
  const chatModelReady = useChatModelReady(settings.modelId);
  const [draft, setDraft] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const listRef = useRef<FlatList<TranscriptMessage>>(null);

  // Typing keeps the newest text in view.
  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [draft]);

  // Android does not resize this screen for the keyboard, so the composer is lifted by the keyboard height.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, event => setKeyboardHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const busy = isBusy(state.phase);
  const listening = state.phase === 'listening';
  const speaking = state.phase === 'speaking';
  const cameraOn =
    state.cameraActive ||
    glasses.cameraState === 'STREAMING' ||
    glasses.cameraState === 'STARTING';
  const connection = connectionSummary(glasses);
  const speechDisabled = settings.speechInput === 'text';
  const hasText = draft.trim().length > 0;
  // While the model writes, the reply so far is shown as a last message that grows as each token arrives.
  const listData: TranscriptMessage[] = state.streamText
    ? [...state.messages, { id: 'streaming', role: 'assistant', text: state.streamText, createdAt: Date.now() }]
    : state.messages;

  useEffect(() => {
    if (state.messages.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [state.messages.length]);

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    actions.sendText(text);
  };

  const sendSuggestion = (text: string) => {
    if (busy) return;
    actions.sendText(text);
  };

  const setVoiceMode = (enabled: boolean) => {
    update({ voiceMode: enabled });
    actions.setVoiceMode(enabled);
  };

  /** Speaks into the text box. The words are added to what is already typed, and nothing is sent. */
  const toggleDictation = () => {
    if (dictating) {
      actions.dictateStop();
      setDictating(false);
      return;
    }
    const base = draft.trimEnd();
    const join = (spoken: string) => (base ? `${base} ${spoken}` : spoken);
    setDictating(true);
    actions.dictateStart({
      onPartial: text => setDraft(join(text)),
      onFinal: text => {
        setDraft(join(text));
        setDictating(false);
      },
      onError: message => {
        setDictating(false);
        Alert.alert('Speech', message);
      },
      onEnd: () => setDictating(false),
    });
  };

  /** Full-screen live mode: the microphone reopens after each reply, and replies are spoken. */
  const openLive = () => {
    if (speechDisabled) {
      Alert.alert('Live voice', 'Turn on phone or glasses speech in Settings first.');
      return;
    }
    setLiveOpen(true);
    setVoiceMode(true);
  };

  const closeLive = () => {
    setLiveOpen(false);
    setVoiceMode(false);
    actions.stopAll();
  };

  const phaseLabel = state.draft
    ? `Hearing: ${state.draft}`
    : state.phase === 'processing' && state.loadProgress !== undefined
      ? `Loading model… ${Math.round(state.loadProgress * 100)}%`
      : PHASE_LABEL[state.phase];

  // One round button on the right of the composer changes with what the user can do next.
  const composerAction = (() => {
    if (busy && !listening) {
      return { label: 'Stop', variant: 'stop' as const, onPress: () => actions.stopAll() };
    }
    if (listening) {
      return { label: 'Stop', variant: 'stop' as const, onPress: () => actions.stopListening() };
    }
    if (hasText) {
      return { label: 'Send', variant: 'send' as const, onPress: send };
    }
    return {
      label: 'Speak',
      variant: 'speak' as const,
      onPress: () => actions.startListening(),
      disabled: speechDisabled || speaking,
    };
  })();

  return (
    <KeyboardAvoidingView
      style={[
        styles.flex,
        { backgroundColor: palette.background, paddingBottom: keyboardHeight > 0 ? keyboardHeight : insets.bottom },
      ]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <CircleButton label="Open chats" glyph="≡" onPress={() => setDrawerOpen(true)} />
        <Text style={[styles.topTitle, { color: palette.text }]}>Buddy</Text>
        <View style={styles.topActions}>
          <CircleButton label="Settings" glyph="⚙" onPress={() => navigation.navigate('Settings')} />
        </View>
      </View>

      <View style={styles.statusRow}>
        <StatusPill label={CONNECTION_LABEL[connection]} tone={CONNECTION_TONE[connection]} />
        {cameraOn ? <StatusPill label="● Camera on" tone="danger" /> : null}
        <View style={styles.flex} />
        <Pressable
          onPress={() => actions.clearConversation()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Clear conversation"
        >
          <Text style={[styles.clear, { color: busy ? palette.mutedText : palette.danger }]}>Clear</Text>
        </Pressable>
      </View>

      {state.lastError ? (
        <View style={styles.notice}>
          <Notice message={state.lastError} onDismiss={actions.clearError} />
          {state.phase === 'error' && state.lastUserText ? (
            <Pressable
              onPress={() => actions.retry()}
              accessibilityRole="button"
              accessibilityLabel="Retry"
              style={[styles.retry, { backgroundColor: palette.accent }]}
            >
              <Text style={[styles.retryLabel, { color: palette.accentText }]}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {state.messages.length === 0 && !state.streamText ? (
        <View style={styles.empty}>
          <Text style={[styles.greeting, { color: palette.text }]}>What's on your mind?</Text>
          <Text style={[styles.greetingBody, { color: palette.mutedText }]}>
            Replies are made on this phone, so nothing you write is sent to a server.
          </Text>
          <View style={styles.suggestions}>
            {SUGGESTIONS.map(item => (
              <SuggestionRow
                key={item.label}
                label={item.label}
                mark={item.mark}
                onPress={() => sendSuggestion(item.label)}
              />
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={listData}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.transcript}
          onScroll={event => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            setAtBottom(contentSize.height - (contentOffset.y + layoutMeasurement.height) < 80);
          }}
          scrollEventThrottle={64}
          renderItem={({ item }) => {
            const last = state.messages[state.messages.length - 1];
            const canContinue = !busy && item.id === last?.id && !!last?.truncated;
            // The reply being written: the streaming bubble, or the reply being continued.
            const streaming = item.id === 'streaming' || (busy && item.id === last?.id && item.role === 'assistant');
            return (
              <MessageBubble
                message={item}
                streaming={streaming}
                showContinue={canContinue}
                onContinue={() => actions.continueReply()}
              />
            );
          }}
        />
      )}

      {!atBottom && (busy || state.streamText) ? (
        <Pressable
          onPress={jumpToEnd}
          accessibilityRole="button"
          accessibilityLabel="Jump to the latest text"
          style={[styles.jumpButton, { backgroundColor: palette.surface, borderColor: palette.border }]}
        >
          <Text style={[styles.jumpLabel, { color: palette.accent }]}>↓</Text>
        </Pressable>
      ) : null}

      <View style={styles.footer}>
        <View style={styles.footerMeta}>
          <Text style={[styles.phase, { color: palette.mutedText }]} accessibilityLiveRegion="polite">
            {dictating ? 'Listening… speak now' : phaseLabel}
          </Text>
        </View>

        {speaking ? (
          <Pressable
            onPress={() => actions.stopSpeaking()}
            accessibilityRole="button"
            accessibilityLabel="Stop speaking"
            style={[styles.stopSpeaking, { borderColor: palette.border }]}
          >
            <Text style={[styles.stopSpeakingLabel, { color: palette.danger }]}>Stop speaking</Text>
          </Pressable>
        ) : null}

        <View style={[styles.composer, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {attachedImage ? (
            <View style={styles.attachmentRow}>
              <Text style={[styles.attachmentText, { color: palette.mutedText }]}>
                Image attached · {attachedImage.characters} characters read
              </Text>
              <Pressable onPress={actions.removeImage} accessibilityRole="button" accessibilityLabel="Remove image">
                <Text style={[styles.attachmentRemove, { color: palette.accent }]}>Remove</Text>
              </Pressable>
            </View>
          ) : null}
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask Buddy…"
            placeholderTextColor={palette.mutedText}
            style={[styles.input, { color: palette.text }]}
            onSubmitEditing={send}
            returnKeyType="send"
            editable={!busy}
            multiline
            accessibilityLabel="Message"
          />
          <View style={styles.composerBottom}>
            <CircleButton
              label="Add image"
              glyph="+"
              onPress={async () => {
                const error = await actions.attachImage();
                if (error) Alert.alert('Image', error);
              }}
            />
            <Pressable
              onPress={() => navigation.navigate('Models')}
              accessibilityRole="button"
              accessibilityLabel={`Model ${findModel(settings.modelId).label}. Change model`}
              style={[styles.modelChip, { borderColor: palette.border }]}
            >
              <Text style={[styles.modelChipLabel, { color: palette.text }]} numberOfLines={1}>
                {chatModelReady === false
                  ? 'Choose model'
                  : `${findModel(settings.modelId).label.replace(/\s*\(.*\)\s*$/, '')} ▾`}
              </Text>
            </Pressable>
            <View style={styles.flex} />
            {hasText ? (
              <ComposerButton label="Send" variant="send" disabled={busy} onPress={send} />
            ) : (
              <>
                <CircleButton
                  label={dictating ? 'Stop dictation' : 'Speak into the text box'}
                  glyph={dictating ? '■' : '🎤'}
                  onPress={toggleDictation}
                />
                <CircleButton label="Live voice mode" glyph="✦" onPress={openLive} />
              </>
            )}
          </View>
        </View>
      </View>
      <Modal visible={liveOpen} animationType="slide" onRequestClose={closeLive}>
        <View style={[styles.liveRoot, { backgroundColor: palette.background, paddingTop: insets.top + spacing.lg }]}>
          <View style={styles.liveHeader}>
            <Text style={[styles.liveTitle, { color: palette.text }]}>✦ Live</Text>
            <CircleButton label="End live mode" glyph="✕" onPress={closeLive} />
          </View>
          <View style={styles.liveBody}>
            <Text style={[styles.liveReply, { color: palette.text }]} accessibilityLiveRegion="polite">
              {state.streamText ||
                [...state.messages].reverse().find(message => message.role === 'assistant')?.text ||
                'Ask Buddy anything. Speak, and Buddy answers out loud.'}
            </Text>
            {state.draft ? (
              <Text style={[styles.liveDraft, { color: palette.mutedText }]}>“{state.draft}”</Text>
            ) : null}
          </View>
          <Text style={[styles.phase, { color: palette.mutedText, textAlign: 'center' }]}>{phaseLabel}</Text>
          <View style={[styles.liveControls, { paddingBottom: insets.bottom + spacing.xl }]}>
            <CircleButton
              label={listening ? 'Stop listening' : 'Start listening'}
              glyph={listening ? '■' : '🎤'}
              onPress={() => (listening ? actions.stopListening() : actions.startListening())}
            />
            {speaking ? (
              <CircleButton label="Stop speaking" glyph="⏸" onPress={() => actions.stopSpeaking()} />
            ) : null}
          </View>
        </View>
      </Modal>
      <ChatDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        chats={chats}
        currentChatId={currentChatId}
        historyOn={settings.keepHistory}
        onNew={() => actions.newChat()}
        onOpen={id => actions.openChat(id)}
        onDelete={id => actions.removeChat(id)}
        onNavigate={route => navigation.navigate(route)}
      />
    </KeyboardAvoidingView>
  );
}

type DrawerRoute = 'Home' | 'Glasses' | 'Settings';

/** Left-side panel with saved chats. Opening, starting or deleting a chat closes it. */
function ChatDrawer({
  visible,
  onClose,
  chats,
  currentChatId,
  historyOn,
  onNew,
  onOpen,
  onDelete,
  onNavigate,
}: {
  visible: boolean;
  onClose: () => void;
  chats: ChatSummary[];
  currentChatId: string | null;
  historyOn: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onNavigate: (route: DrawerRoute) => void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.drawerRoot}>
        <View
          style={[
            styles.drawer,
            { backgroundColor: palette.surface, borderColor: palette.border, paddingTop: insets.top + spacing.lg },
          ]}
        >
          <Text style={[styles.drawerTitle, { color: palette.text }]}>Chats</Text>
          <Pressable
            onPress={() => {
              onClose();
              onNew();
            }}
            accessibilityRole="button"
            accessibilityLabel="New chat"
            style={[styles.drawerNew, { backgroundColor: palette.accent }]}
          >
            <Text style={[styles.drawerNewLabel, { color: palette.accentText }]}>New chat</Text>
          </Pressable>

          {historyOn ? null : (
            <Text style={[styles.drawerHint, { color: palette.mutedText }]}>
              Chat history is off. Turn on “Keep conversation history” in Settings to save chats on this phone.
            </Text>
          )}
          {historyOn && chats.length === 0 ? (
            <Text style={[styles.drawerHint, { color: palette.mutedText }]}>No saved chats yet.</Text>
          ) : null}

          <FlatList
            data={chats}
            keyExtractor={item => item.id}
            style={styles.drawerList}
            renderItem={({ item }) => (
              <View style={[styles.chatRow, { borderColor: palette.border }]}>
                <Pressable
                  onPress={() => {
                    onClose();
                    onOpen(item.id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Open chat ${item.title}`}
                  style={styles.chatOpen}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.chatTitle,
                      { color: palette.text, fontWeight: item.id === currentChatId ? '700' : '500' },
                    ]}
                  >
                    {item.title}
                  </Text>
                  <Text style={[styles.chatDate, { color: palette.mutedText }]}>
                    {new Date(item.updatedAt).toLocaleDateString()}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => onDelete(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete chat ${item.title}`}
                  style={styles.chatDelete}
                >
                  <Text style={[styles.chatDeleteLabel, { color: palette.danger }]}>Delete</Text>
                </Pressable>
              </View>
            )}
          />

          <View style={[styles.drawerLinks, { borderColor: palette.border, paddingBottom: insets.bottom + spacing.md }]}>
            {(['Home', 'Glasses', 'Settings'] as const).map(route => (
              <Pressable
                key={route}
                onPress={() => {
                  onClose();
                  onNavigate(route);
                }}
                accessibilityRole="button"
                accessibilityLabel={route}
              >
                <Text style={[styles.drawerLink, { color: palette.accent }]}>{route}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close chats" />
      </View>
    </Modal>
  );
}

function CircleButton({ label, glyph, onPress }: { label: string; glyph: string; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.circle, { backgroundColor: palette.surface, borderColor: palette.border }]}
    >
      <Text style={[styles.circleGlyph, { color: palette.text }]}>{glyph}</Text>
    </Pressable>
  );
}

function SuggestionRow({ label, mark, onPress }: { label: string; mark: string; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.suggestion, { opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[styles.mark, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text style={[styles.markText, { color: palette.accent }]}>{mark}</Text>
      </View>
      <Text style={[styles.suggestionLabel, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

function ComposerButton({
  label,
  variant,
  disabled,
  onPress,
}: {
  label: string;
  variant: 'send' | 'speak' | 'stop';
  disabled?: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  const background =
    variant === 'stop' ? palette.dangerSurface : variant === 'send' ? palette.accent : palette.neutralSurface;
  const foreground =
    variant === 'stop' ? palette.danger : variant === 'send' ? palette.accentText : palette.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.composerButton,
        { backgroundColor: background, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={[styles.composerButtonLabel, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

type ReplyPart = { kind: 'text' | 'code'; value: string; language: string };

/** Splits a reply into text and code blocks. A block that is still being written counts as code up to its end. */
function splitReply(text: string): ReplyPart[] {
  const parts: ReplyPart[] = [];
  const pattern = /```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g;
  let index = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    if (match.index > index) parts.push({ kind: 'text', value: text.slice(index, match.index), language: '' });
    parts.push({ kind: 'code', value: match[2].replace(/\n$/, ''), language: match[1].trim() });
    index = pattern.lastIndex;
  }
  if (index < text.length) parts.push({ kind: 'text', value: text.slice(index), language: '' });
  return parts;
}

/** A reply: markdown for the text, and a block with a Copy button for each piece of code. */
function AssistantText({ text }: { text: string }) {
  const palette = usePalette();
  return (
    <View style={styles.replyStack}>
      {splitReply(text).map((part, index) =>
        part.kind === 'code' ? (
          <CodeBlock key={index} code={part.value} language={part.language} />
        ) : part.value.trim() ? (
          <Markdown key={index} style={markdownStyle(palette)}>
            {part.value}
          </Markdown>
        ) : null,
      )}
    </View>
  );
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const palette = usePalette();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <View style={[styles.codeBlock, { backgroundColor: palette.neutralSurface, borderColor: palette.border }]}>
      <View style={styles.codeHeader}>
        <Text style={[styles.codeLanguage, { color: palette.mutedText }]}>{language || 'code'}</Text>
        <Pressable
          onPress={copy}
          accessibilityRole="button"
          accessibilityLabel={copied ? 'Code copied' : 'Copy code'}
          style={[styles.copyButton, { borderColor: palette.border }]}
        >
          <Text style={[styles.copyLabel, { color: palette.accent }]}>{copied ? 'Copied' : 'Copy'}</Text>
        </Pressable>
      </View>
      <Text selectable style={[styles.codeText, { color: palette.text }]}>
        {code}
      </Text>
    </View>
  );
}

/** Markdown styles for assistant replies, using the app's theme colours and fonts. */
function markdownStyle(palette: ReturnType<typeof usePalette>) {
  return {
    body: { color: palette.text, fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
    paragraph: { marginTop: 0, marginBottom: spacing.sm },
    heading1: { color: palette.text, fontFamily: fonts.displayBold, fontSize: 22, marginBottom: spacing.xs },
    heading2: { color: palette.text, fontFamily: fonts.displayBold, fontSize: 19, marginBottom: spacing.xs },
    heading3: { color: palette.text, fontFamily: fonts.display, fontSize: 17, marginBottom: spacing.xs },
    strong: { fontFamily: fonts.bold },
    bullet_list: { marginBottom: spacing.sm },
    code_inline: {
      color: palette.accent,
      backgroundColor: palette.neutralSurface,
      fontFamily: 'monospace',
      fontSize: 14,
      paddingHorizontal: 4,
      borderRadius: 4,
    },
    fence: {
      color: palette.text,
      backgroundColor: palette.neutralSurface,
      borderColor: palette.border,
      fontFamily: 'monospace',
      fontSize: 13,
      padding: spacing.md,
      borderRadius: radius.md,
    },
    code_block: {
      color: palette.text,
      backgroundColor: palette.neutralSurface,
      fontFamily: 'monospace',
      fontSize: 13,
      padding: spacing.md,
      borderRadius: radius.md,
    },
  } as const;
}

/**
 * A reply that is still being written. Each new piece fades in, and a cursor blinks at the end until the reply is
 * finished.
 */
function StreamingReply({ text }: { text: string }) {
  const palette = usePalette();
  const fade = useRef(new Animated.Value(0.5)).current;
  const cursor = useRef(new Animated.Value(1)).current;

  // Every new piece of text fades in briefly.
  useEffect(() => {
    fade.setValue(0.5);
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [text, fade]);

  useEffect(() => {
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(cursor, { toValue: 0, duration: 450, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(cursor, { toValue: 1, duration: 450, easing: Easing.linear, useNativeDriver: true }),
      ]),
    );
    blink.start();
    return () => blink.stop();
  }, [cursor]);

  return (
    <Animated.View style={{ opacity: fade }}>
      <AssistantText text={text} />
      <Animated.View style={[styles.cursor, { backgroundColor: palette.accent, opacity: cursor }]} />
    </Animated.View>
  );
}

function MessageBubble({
  message,
  streaming = false,
  showContinue = false,
  onContinue,
}: {
  message: TranscriptMessage;
  streaming?: boolean;
  showContinue?: boolean;
  onContinue?: () => void;
}) {
  const palette = usePalette();
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  return (
    <View style={[styles.bubbleWrap, isUser ? styles.alignEnd : styles.alignStart]}>
      <View
        style={[
          styles.bubble,
          isUser
            ? { backgroundColor: palette.accent }
            : isSystem
              ? { backgroundColor: palette.neutralSurface }
              : { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: StyleSheet.hairlineWidth },
        ]}
        accessibilityLabel={`${message.role}: ${message.text}`}
      >
        {isUser || isSystem ? (
          <Text
            style={[
              styles.bubbleText,
              {
                color: isUser ? palette.accentText : palette.mutedText,
              },
            ]}
          >
            {message.text}
          </Text>
        ) : (
          // Assistant replies are markdown: headings, paragraphs, lists and code blocks.
          streaming ? <StreamingReply text={message.text} /> : <AssistantText text={message.text} />
        )}
        {showContinue && onContinue ? (
          <Pressable
            onPress={onContinue}
            accessibilityRole="button"
            accessibilityLabel="Continue the reply"
            style={[styles.continueButton, { borderColor: palette.border }]}
          >
            <Text style={[styles.continueLabel, { color: palette.accent }]}>Continue ›</Text>
          </Pressable>
        ) : null}
        {message.withImage ? (
          <Text style={[styles.imageTag, { color: isUser ? palette.accentText : palette.mutedText }]}>
            With glasses photo
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  topTitle: { flex: 1, fontSize: 20, fontWeight: '600' },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleGlyph: { fontSize: 20, fontWeight: '600' },
  textButton: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButtonLabel: { fontSize: 15, fontWeight: '600' },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  clear: { fontSize: 15, fontWeight: '600', paddingHorizontal: spacing.xs },
  notice: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  retry: {
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryLabel: { fontSize: 15, fontWeight: '600' },
  empty: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  greeting: { fontSize: 34, fontWeight: '600', lineHeight: 40 },
  greetingBody: { fontSize: 15, lineHeight: 22 },
  suggestions: { gap: spacing.lg, marginTop: spacing.xl },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  mark: {
    width: 56,
    height: 56,
    borderRadius: radius.md * 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: { fontSize: 20, fontWeight: '700' },
  suggestionLabel: { fontSize: 17, flexShrink: 1 },
  transcript: { padding: spacing.lg, gap: spacing.md },
  bubbleWrap: { flexDirection: 'row' },
  alignEnd: { justifyContent: 'flex-end' },
  alignStart: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '85%',
    borderRadius: radius.md * 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  bubbleText: { fontSize: 16, lineHeight: 22 },
  imageTag: { fontSize: 12 },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  footerMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  phase: { fontSize: 13, minHeight: 18, flexShrink: 1 },
  voiceToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  voiceLabel: { fontSize: 13, fontWeight: '600' },
  stopSpeaking: {
    alignSelf: 'flex-start',
    height: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopSpeakingLabel: { fontSize: 15, fontWeight: '600' },
  composer: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md * 3,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    minHeight: 110,
  },
  input: { fontSize: 17, maxHeight: 160, paddingTop: 0, paddingBottom: spacing.sm },
  composerBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  attachmentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  attachmentText: { fontSize: 13, flexShrink: 1 },
  attachmentRemove: { fontSize: 14, fontWeight: '600' },
  composerButton: {
    height: 44,
    minWidth: 72,
    paddingHorizontal: spacing.lg,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerButtonLabel: { fontSize: 15, fontWeight: '700' },
  modelChip: {
    height: 40,
    maxWidth: 170,
    paddingHorizontal: spacing.md,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  modelChipLabel: { fontSize: 14, fontWeight: '600' },
  liveRoot: { flex: 1, paddingHorizontal: spacing.xl, gap: spacing.lg },
  liveHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  liveTitle: { fontSize: 22, fontWeight: '700' },
  liveBody: { flex: 1, justifyContent: 'center', gap: spacing.md },
  liveReply: { fontSize: 22, lineHeight: 30, textAlign: 'center' },
  liveDraft: { fontSize: 16, textAlign: 'center', fontStyle: 'italic' },
  liveControls: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xl },
  replyStack: { gap: spacing.sm },
  cursor: { width: 2, height: 16, borderRadius: 1, marginTop: 2 },
  jumpButton: {
    position: 'absolute',
    right: spacing.lg,
    bottom: 150,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  jumpLabel: { fontSize: 20, fontWeight: '700' },
  codeBlock: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  codeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  codeLanguage: { fontSize: 12, fontWeight: '600' },
  copyButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  copyLabel: { fontSize: 13, fontWeight: '600' },
  codeText: { fontFamily: 'monospace', fontSize: 13, lineHeight: 18, padding: spacing.md },
  continueButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  continueLabel: { fontSize: 13, fontWeight: '600' },
  drawerRoot: { flex: 1, flexDirection: 'row' },
  drawer: {
    width: '80%',
    maxWidth: 340,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  scrim: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)' },
  drawerTitle: { fontSize: 24, fontWeight: '700' },
  drawerNew: { height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  drawerNewLabel: { fontSize: 16, fontWeight: '700' },
  drawerHint: { fontSize: 13, lineHeight: 18 },
  drawerList: { flex: 1 },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chatOpen: { flex: 1, gap: spacing.xs },
  chatTitle: { fontSize: 15 },
  chatDate: { fontSize: 12 },
  chatDelete: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  chatDeleteLabel: { fontSize: 13, fontWeight: '600' },
  drawerLinks: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  drawerLink: { fontSize: 15, fontWeight: '600' },
});
