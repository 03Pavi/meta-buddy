import { Platform } from 'react-native';
import type { RecognitionCallbacks, SpeechRecognitionProvider } from '../types';

type VoskModule = typeof import('react-native-vosk');

// Loaded on first use, so the native module is never evaluated in a browser.
function vosk(): VoskModule {
  return require('react-native-vosk') as VoskModule;
}

/**
 * Offline speech recognition with a Vosk model that is already on the phone. Audio never leaves the device.
 * The caller must make sure the model is downloaded first.
 */
export class OfflineSpeechRecognition implements SpeechRecognitionProvider {
  readonly id = 'offline-speech' as const;
  private loadedPath: string | null = null;
  private subscriptions: Array<{ remove: () => void }> = [];

  constructor(private readonly modelPath: string) {}

  async isAvailable(): Promise<boolean> {
    return Platform.OS === 'android';
  }

  async start(_locale: string, callbacks: RecognitionCallbacks): Promise<void> {
    this.unsubscribe();
    try {
      const engine = vosk();
      if (this.loadedPath !== this.modelPath) {
        await engine.loadModel(this.modelPath);
        this.loadedPath = this.modelPath;
      }
      this.subscriptions = [
        engine.onPartialResult(text => {
          if (text) callbacks.onPartial(text);
        }),
        engine.onFinalResult(text => {
          const trimmed = (text ?? '').trim();
          this.unsubscribe();
          if (trimmed) {
            callbacks.onFinal(trimmed);
          } else {
            callbacks.onError('no_speech', "I didn't catch that. Try again.");
          }
          callbacks.onEnd();
        }),
        engine.onError(error => {
          this.unsubscribe();
          callbacks.onError('failed', String(error));
          callbacks.onEnd();
        }),
        engine.onTimeout(() => {
          this.unsubscribe();
          callbacks.onError('no_speech', "I didn't catch that. Try again.");
          callbacks.onEnd();
        }),
      ];
      await engine.start();
    } catch (error) {
      this.unsubscribe();
      const message = error instanceof Error ? error.message : String(error);
      if (/permission/i.test(message)) {
        callbacks.onError('permission', 'Microphone permission is needed for voice input.');
      } else {
        callbacks.onError('failed', `Offline speech could not start. ${message}`);
      }
      callbacks.onEnd();
    }
  }

  async stop(): Promise<void> {
    if (this.loadedPath) vosk().stop();
  }

  async destroy(): Promise<void> {
    this.unsubscribe();
    if (this.loadedPath) {
      vosk().unload();
      this.loadedPath = null;
    }
  }

  private unsubscribe(): void {
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions = [];
  }
}
