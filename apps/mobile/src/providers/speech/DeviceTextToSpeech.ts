
import type { SpeakCallbacks, TextToSpeechProvider } from '../types';

// Loaded on first use, so the module is never evaluated in a browser (where it has no native side).
function tts() {
  return require('react-native-tts').default as typeof import('react-native-tts').default;
}

/**
 * Phone text-to-speech through the platform engine (Android TextToSpeech, iOS AVSpeechSynthesizer).
 * Audio goes to the current output. If the glasses are the active Bluetooth audio device, the platform routes it there.
 */
export class DeviceTextToSpeech implements TextToSpeechProvider {
  readonly id = 'device-tts' as const;
  private current: SpeakCallbacks | null = null;
  private ready = false;

  constructor(private readonly language = 'en-US') {}

  private readonly handlers = {
    'tts-start': () => this.current?.onStart?.(),
    'tts-finish': () => this.finish(() => this.current?.onDone()),
    'tts-cancel': () => this.finish(() => this.current?.onDone()),
    'tts-error': () => this.finish(() => this.current?.onError('Playback failed')),
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

  speak(text: string, callbacks: SpeakCallbacks): void {
    this.current = callbacks;
    this.init()
      .then(() => {
        tts().speak(text);
      })
      .catch(() => {
        this.finish(() => callbacks.onError('Text-to-speech is not available on this device'));
      });
  }

  async stop(): Promise<void> {
    this.current = null;
    await tts().stop().catch(() => undefined);
  }
}
