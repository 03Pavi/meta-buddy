import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import {
  METAWEARABLES_EVENTS,
  mapNativeEvent,
  type MetaWearablesEvent,
} from './events';
import type {
  CameraOptions,
  GlassesSnapshot,
  PermissionName,
  PermissionStatus,
  PhotoCapture,
} from './types';

export * from './types';
export {
  mapNativeEvent,
  METAWEARABLES_EVENTS,
  type MetaWearablesEvent,
} from './events';

/** Shape of the native module's methods. Each returns a promise that rejects with a native error code. */
interface NativeMetaWearables {
  initialize(): Promise<GlassesSnapshot>;
  getSnapshot(): Promise<GlassesSnapshot>;
  startRegistration(): Promise<string>;
  startUnregistration(): Promise<string>;
  checkPermission(name: PermissionName): Promise<PermissionStatus>;
  requestPermission(name: PermissionName): Promise<PermissionStatus>;
  connect(): Promise<GlassesSnapshot>;
  disconnect(): Promise<GlassesSnapshot>;
  startCamera(options: CameraOptions): Promise<GlassesSnapshot>;
  stopCamera(): Promise<GlassesSnapshot>;
  capturePhoto(): Promise<PhotoCapture>;
  startGlassesSpeech(): Promise<GlassesSnapshot>;
  stopGlassesSpeech(): Promise<GlassesSnapshot>;
  startPhoneSpeech(): Promise<boolean>;
  stopPhoneSpeech(): Promise<boolean>;
  speak(text: string, utteranceId: string): Promise<boolean>;
  stopSpeaking(): Promise<boolean>;
  startVoiceInvocations(): Promise<GlassesSnapshot>;
  stopVoiceInvocations(): Promise<GlassesSnapshot>;
  respondToInvocation(
    requestId: string,
    success: boolean,
    output: string | null,
  ): Promise<boolean>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

/** Thrown when the native module is missing (iOS, web, Expo Go, or unit tests). */
export class GlassesUnavailableError extends Error {
  readonly code = 'glasses_unavailable';

  constructor(
    message = 'Meta glasses support needs the Android development build',
  ) {
    super(message);
    this.name = 'GlassesUnavailableError';
  }
}

/** A native promise rejection with the native error code preserved. */
export class GlassesError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GlassesError';
    this.code = code;
  }
}

const nativeModule = (NativeModules as { MetaWearables?: NativeMetaWearables })
  .MetaWearables;

export const isGlassesModuleAvailable =
  Platform.OS === 'android' && nativeModule != null;

const emitter =
  isGlassesModuleAvailable && nativeModule
    ? new NativeEventEmitter(nativeModule as never)
    : null;

function native(): NativeMetaWearables {
  if (!nativeModule || !isGlassesModuleAvailable) {
    throw new GlassesUnavailableError();
  }
  return nativeModule;
}

async function call<T>(
  invoke: (module: NativeMetaWearables) => Promise<T>,
): Promise<T> {
  try {
    return await invoke(native());
  } catch (error) {
    if (error instanceof GlassesUnavailableError) throw error;
    const nativeError = error as { code?: string; message?: string };
    throw new GlassesError(
      nativeError.code ?? 'unknown',
      nativeError.message ?? 'Glasses operation failed',
    );
  }
}

/**
 * Public API of the Meta glasses bridge. Each call maps to one documented DAT SDK operation
 * (see apps/mobile/modules/meta-wearables/README.md for the mapping and the dev/beta caveats).
 */
export const MetaWearables = {
  available: isGlassesModuleAvailable,

  initialize: () => call(m => m.initialize()),
  getSnapshot: () => call(m => m.getSnapshot()),

  startRegistration: () => call(m => m.startRegistration()),
  startUnregistration: () => call(m => m.startUnregistration()),

  checkPermission: (name: PermissionName) => call(m => m.checkPermission(name)),
  requestPermission: (name: PermissionName) =>
    call(m => m.requestPermission(name)),

  /** Creates a device session and resolves once it reports STARTED. Capabilities are not added here. */
  connect: () => call(m => m.connect()),
  disconnect: () => call(m => m.disconnect()),

  startCamera: (options: CameraOptions = {}) =>
    call(m => m.startCamera(options)),
  stopCamera: () => call(m => m.stopCamera()),
  capturePhoto: () => call(m => m.capturePhoto()),

  startGlassesSpeech: () => call(m => m.startGlassesSpeech()),
  stopGlassesSpeech: () => call(m => m.stopGlassesSpeech()),
  /** FALLBACK: phone microphone. Only call after the user has chosen it and RECORD_AUDIO is granted. */
  startPhoneSpeech: () => call(m => m.startPhoneSpeech()),
  stopPhoneSpeech: () => call(m => m.stopPhoneSpeech()),

  speak: (text: string, utteranceId: string) =>
    call(m => m.speak(text, utteranceId)),
  stopSpeaking: () => call(m => m.stopSpeaking()),

  startVoiceInvocations: () => call(m => m.startVoiceInvocations()),
  stopVoiceInvocations: () => call(m => m.stopVoiceInvocations()),
  respondToInvocation: (
    requestId: string,
    success: boolean,
    output: string | null = null,
  ) => call(m => m.respondToInvocation(requestId, success, output)),

  /** Subscribes to every native event. Returns an unsubscribe function. */
  subscribe(listener: (event: MetaWearablesEvent) => void): () => void {
    if (!emitter) return () => undefined;
    const subscriptions = Object.values(METAWEARABLES_EVENTS).map(name =>
      emitter.addListener(name, (payload: unknown) => {
        const event = mapNativeEvent(name, payload);
        if (event) listener(event);
      }),
    );
    return () => subscriptions.forEach(subscription => subscription.remove());
  },
};
