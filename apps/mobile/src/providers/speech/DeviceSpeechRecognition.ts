import { NativeModules } from 'react-native';
import type { SpeechErrorEvent, SpeechResultsEvent } from '@react-native-voice/voice';
import type { RecognitionCallbacks, SpeechRecognitionProvider } from '../types';

// Loaded on first use, so the module is never evaluated in a browser (where it has no native side).
function voice() {
  if (!NativeModules.Voice) throw new Error('Phone speech recognition is not available in this build.');
  return require('@react-native-voice/voice').default as typeof import('@react-native-voice/voice').default;
}

/**
 * Phone speech recognition through the platform recognizer (Android SpeechRecognizer, iOS Speech framework),
 * via @react-native-voice/voice. The caller must hold the microphone permission before calling start().
 *
 * Offline use depends on the device: the platform decides whether to use an installed offline language pack
 * or a network service. The app cannot force on-device-only recognition through this library.
 */
export class DeviceSpeechRecognition implements SpeechRecognitionProvider {
  readonly id = 'device-speech' as const;
  private callbacks: RecognitionCallbacks | null = null;
  private listening = false;

  async isAvailable(): Promise<boolean> {
    try {
      return (await voice().isAvailable()) === 1;
    } catch {
      return false;
    }
  }

  async start(locale: string, callbacks: RecognitionCallbacks): Promise<void> {
    if (!NativeModules.Voice) {
      callbacks.onError('failed', 'Phone speech recognition is not available in this build.');
      callbacks.onEnd();
      return;
    }
    this.callbacks = callbacks;
    this.listening = true;

    voice().onSpeechPartialResults = (event: SpeechResultsEvent) => {
      const text = event.value?.[0];
      if (text && this.listening) callbacks.onPartial(text);
    };
    voice().onSpeechResults = (event: SpeechResultsEvent) => {
      const text = event.value?.[0]?.trim();
      this.listening = false;
      if (text) {
        callbacks.onFinal(text);
      } else {
        callbacks.onError('no_speech', "I didn't catch that. Try again.");
      }
      callbacks.onEnd();
    };
    voice().onSpeechError = (event: SpeechErrorEvent) => {
      this.listening = false;
      // Silence timeouts are normal and are reported as "no speech", not as a failure.
      const code = event.error?.code ?? '';
      const message = event.error?.message ?? 'Speech recognition failed';
      if (code === '7' || code === '6' || /no match|timeout/i.test(message)) {
        callbacks.onError('no_speech', "I didn't catch that. Try again.");
      } else if (/permission/i.test(message)) {
        callbacks.onError('permission', 'Microphone permission is needed for voice input.');
      } else {
        callbacks.onError('failed', message);
      }
      callbacks.onEnd();
    };

    await voice().start(locale);
  }

  async stop(): Promise<void> {
    this.listening = false;
    if (!NativeModules.Voice) return;
    await voice().stop().catch(() => undefined);
  }

  async destroy(): Promise<void> {
    this.listening = false;
    this.callbacks = null;
    await voice().destroy().catch(() => undefined);
    voice().removeAllListeners();
  }
}
