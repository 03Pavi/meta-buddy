export type AssistantPhase =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'capturing'
  | 'speaking'
  | 'error';

export interface TranscriptMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  createdAt: number;
  /** True when the user message was sent with a camera frame. The image itself is never stored. */
  withImage?: boolean;
  /** True when an assistant reply stopped at the length limit, so a Continue button is shown. */
  truncated?: boolean;
}

export interface AssistantState {
  phase: AssistantPhase;
  messages: TranscriptMessage[];
  /** Partial speech text, shown while the user is still talking. */
  draft: string;
  conversationId?: string;
  /** Set when the backend reports the earlier context was lost. */
  contextReset: boolean;
  cameraActive: boolean;
  lastError?: string;
  /** Request id of the in-flight backend call, used to ignore stale replies. */
  pendingRequestId?: string;
  /** Text of the last user turn, kept so a failed request can be retried. */
  lastUserText?: string;
  /** Model load progress, 0 to 1, while the on-device model is loading. */
  loadProgress?: number;
  /** The reply so far, while the model is still writing it. Cleared when the reply is complete. */
  streamText: string;
}

export type AssistantAction =
  | { type: 'transcriptLoaded'; messages: TranscriptMessage[] }
  | { type: 'messageAdded'; message: TranscriptMessage }
  | { type: 'requestStarted'; requestId: string; withImage: boolean; text?: string }
  | { type: 'loadProgressChanged'; fraction?: number }
  /** The reply text so far, from the model's token stream. */
  | { type: 'streamChunk'; text: string }
  /** Replaces the text of an existing reply, used when a truncated reply is continued in place. */
  | { type: 'replyExtended'; id: string; text: string; truncated: boolean }
  | {
      type: 'requestFinished';
      requestId: string;
      conversationId: string;
      reply: TranscriptMessage;
      contextReset: boolean;
    }
  | { type: 'requestFailed'; requestId: string; message: string }
  | { type: 'requestCancelled'; requestId: string }
  /** An error not tied to a backend request, such as speech input or playback. */
  | { type: 'failed'; message: string }
  | { type: 'phaseChanged'; phase: AssistantPhase }
  | { type: 'draftChanged'; draft: string }
  | { type: 'cameraChanged'; active: boolean }
  | { type: 'errorCleared' }
  | { type: 'conversationCleared' };

export const initialAssistantState: AssistantState = {
  phase: 'idle',
  messages: [],
  draft: '',
  contextReset: false,
  cameraActive: false,
  streamText: '',
};

export function assistantReducer(
  state: AssistantState,
  action: AssistantAction,
): AssistantState {
  switch (action.type) {
    case 'transcriptLoaded':
      return { ...state, messages: action.messages };
    case 'messageAdded':
      return { ...state, messages: [...state.messages, action.message] };
    case 'requestStarted':
      return {
        ...state,
        phase: action.withImage ? 'capturing' : 'processing',
        pendingRequestId: action.requestId,
        lastUserText: action.text ?? state.lastUserText,
        lastError: undefined,
        draft: '',
        streamText: '',
      };
    case 'loadProgressChanged':
      return { ...state, loadProgress: action.fraction };
    case 'streamChunk':
      return { ...state, streamText: action.text };
    case 'replyExtended':
      return {
        ...state,
        messages: state.messages.map(message =>
          message.id === action.id ? { ...message, text: action.text, truncated: action.truncated } : message,
        ),
      };
    case 'requestFinished':
      if (state.pendingRequestId !== action.requestId) return state;
      return {
        ...state,
        phase: 'speaking',
        pendingRequestId: undefined,
        conversationId: action.conversationId,
        contextReset: action.contextReset,
        messages: [...state.messages, action.reply],
        streamText: '',
      };
    case 'requestFailed':
      if (state.pendingRequestId !== action.requestId) return state;
      return {
        ...state,
        phase: 'error',
        pendingRequestId: undefined,
        lastError: action.message,
        streamText: '',
      };
    case 'requestCancelled':
      if (state.pendingRequestId !== action.requestId) return state;
      return { ...state, phase: 'idle', pendingRequestId: undefined, streamText: '' };
    case 'failed':
      return { ...state, phase: 'error', lastError: action.message };
    case 'phaseChanged':
      return { ...state, phase: action.phase };
    case 'draftChanged':
      return { ...state, draft: action.draft };
    case 'cameraChanged':
      return { ...state, cameraActive: action.active };
    case 'errorCleared':
      return {
        ...state,
        lastError: undefined,
        phase: state.phase === 'error' ? 'idle' : state.phase,
      };
    case 'conversationCleared':
      return { ...initialAssistantState, messages: [] };
    default:
      return state;
  }
}

/** True while a request is in flight. New user requests are ignored in this state (duplicate protection). */
export function isBusy(phase: AssistantPhase): boolean {
  return phase === 'processing' || phase === 'capturing';
}
