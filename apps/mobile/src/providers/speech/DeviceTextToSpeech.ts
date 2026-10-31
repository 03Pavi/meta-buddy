import type { SpeakCallbacks, TextToSpeechProvider } from '../types';

// Loaded on first use, so the module is never evaluated in a browser (where it has no native side).
function tts() {
  return require('react-native-tts').default as typeof import('react-native-tts').default;
}

/**
 * Phone text-to-speech through the platform engine (Android TextToSpeech, iOS AVSpeechSynthesizer).
 * Audio goes to the current output. If the glasses are the active Bluetooth audio device, the platform routes it there.
 *
 * A reply can be spoken as it is written: call beginStream, then speakChunk for each sentence as it arrives, then
 * endStream. Chunks play in order. onDone runs once the last chunk has finished.
 */
export class DeviceTextToSpeech implements TextToSpeechProvider {
  readonly id = 'device-tts' as const;
  private current: SpeakCallbacks | null = null;
  private ready = false;
  /** Chunks queued but not yet finished. */
  private queued = 0;
  /** True between beginStream and endStream: more chunks may still arrive. */
  private streaming = false;

  /** `rate` is read at the start of each reply, so a change in Settings applies to the next one. 1 is normal speed. */
  constructor(
    private readonly language = 'en-US',
    private readonly rate: () => number = () => 1,
  ) {}

  private readonly handlers = {
    'tts-start': () => this.current?.onStart?.(),
    'tts-finish': () => {
      this.queued = Math.max(0, this.queued - 1);
      this.finishIfDone();
    },
    'tts-cancel': () => {
      this.queued = 0;
      this.streaming = false;
      this.finish(() => this.current?.onDone());
    },
    'tts-error': () => {
      this.queued = 0;
      this.streaming = false;
      this.finish(() => this.current?.onError('Playback failed'));
    },
  };

  private listening = false;

  private ensureListeners(): void {
    if (this.listening) return;
    this.listening = true;
    tts().addEventListener('tts-start', this.handlers['tts-start']);
    tts().addEventListener('tts-finish', this.handlers['tts-finish']);
    tts().addEventListener('tts-cancel', this.handlers['tts-cancel']);
    tts().addEventListener('tts-error', this.handlers['tts-error']);
  }

  private finish(action: () => void): void {
    const callbacks = this.current;
    this.current = null;
    if (callbacks) action();
  }

  /** onDone runs only when no more chunks are coming and nothing is still playing. */
  private finishIfDone(): void {
    if (!this.streaming && this.queued === 0) {
      this.finish(() => this.current?.onDone());
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.init();
      return true;
    } catch {
      return false;
    }
  }

  private async init(): Promise<void> {
    if (this.ready) return;
    this.ensureListeners();
    await tts().getInitStatus();
    await tts().setDefaultLanguage(this.language).catch(() => undefined);
    this.ready = true;
  }

  /** Starts a reply that will be spoken in chunks. The rate is applied once, for the whole reply. */
  beginStream(callbacks: SpeakCallbacks): void {
    this.current = callbacks;
    this.queued = 0;
    this.streaming = true;
    this.init()
      .then(() => tts().setDefaultRate(this.rate(), true))
      .catch(() => undefined);
  }

  /** Queues one piece of the reply. Pieces play in the order they are queued. */
  speakChunk(text: string): void {
    if (!text.trim()) return;
    this.queued += 1;
    this.init()
      .then(() => tts().speak(text))
      .catch(() => {
        this.queued = Math.max(0, this.queued - 1);
        this.streaming = false;
        this.finish(() => this.current?.onError('Text-to-speech is not available on this device'));
      });
  }

  /** No more chunks will be queued for this reply. onDone runs when the last one has finished. */
  endStream(): void {
    this.streaming = false;
    this.finishIfDone();
  }

  /** Speaks a whole reply at once. Same as beginStream, one chunk, endStream. */
  speak(text: string, callbacks: SpeakCallbacks): void {
    this.beginStream(callbacks);
    this.speakChunk(text);
    this.endStream();
  }

  async stop(): Promise<void> {
    this.current = null;
    this.queued = 0;
    this.streaming = false;
    await tts().stop().catch(() => undefined);
  }
}
