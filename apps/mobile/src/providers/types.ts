/**
 * Provider interfaces. The chat logic depends only on these, so a model, recognizer, speech engine or
 * vision model can be replaced without changing the screens.
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface GenerateRequest {
  /** System prompt, then history, then the current user message. */
  messages: ChatMessage[];
  /** Upper bound on generated tokens. Keeps answers short enough to hear. */
  maxTokens: number;
  signal?: AbortSignal;
  /** Called with the text generated so far. Optional, for streaming UI. */
  onPartial?: (text: string) => void;
}

export interface GenerateResult {
  text: string;
  model: string;
  /** True when the reply stopped at the token limit and more could be written. */
  truncated?: boolean;
}

export interface AIProvider {
  readonly id: 'gemma-on-device';
  readonly label: string;
  /** Whether this provider uses only the device, with no network calls. */
  readonly onDevice: boolean;
  /** Prepare resources (for example load a model). Safe to call more than once. */
  prepare(onProgress?: (fraction: number) => void): Promise<void>;
  generate(request: GenerateRequest): Promise<GenerateResult>;
  /** Stop an in-progress generation. */
  cancel(): Promise<void>;
  /** Free memory held by the provider. */
  release(): Promise<void>;
}

export type RecognitionErrorCode = 'unavailable' | 'permission' | 'no_speech' | 'failed';

export interface RecognitionCallbacks {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (code: RecognitionErrorCode, message: string) => void;
  onEnd: () => void;
}

export interface SpeechRecognitionProvider {
  readonly id: 'device-speech' | 'offline-speech' | 'glasses';
  /** Whether the platform can recognize speech right now. Does not request permission. */
  isAvailable(): Promise<boolean>;
  start(locale: string, callbacks: RecognitionCallbacks): Promise<void>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
}

export interface SpeakCallbacks {
  onStart?: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export interface TextToSpeechProvider {
  readonly id: 'device-tts';
  isAvailable(): Promise<boolean>;
  speak(text: string, callbacks: SpeakCallbacks): void;
  /** Stop speaking now and drop anything queued. */
  stop(): Promise<void>;
}

/** Vision is kept separate from text generation so a multimodal model can be added later. */
export interface VisionProvider {
  readonly id: string;
  readonly supportsImages: boolean;
  describe(image: { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string }, question: string, signal?: AbortSignal): Promise<string>;
}
