import type {
  CameraState,
  NativeErrorEvent,
  RegistrationState,
  SessionState,
  SpeechOutputEvent,
  SpeechResult,
  SpeechSource,
  SpeechState,
  VoiceInvocation,
} from './types';

/** Event names. Keep in sync with MetaWearablesEvents.kt. */
export const METAWEARABLES_EVENTS = {
  registrationState: 'MetaWearables.registrationState',
  devices: 'MetaWearables.devices',
  sessionState: 'MetaWearables.sessionState',
  cameraState: 'MetaWearables.cameraState',
  cameraFrame: 'MetaWearables.cameraFrame',
  speechState: 'MetaWearables.speechState',
  speechResult: 'MetaWearables.speechResult',
  voiceInvocation: 'MetaWearables.voiceInvocation',
  speechOutput: 'MetaWearables.speechOutput',
  error: 'MetaWearables.error',
} as const;

export type MetaWearablesEvent =
  | { type: 'registrationChanged'; state: RegistrationState }
  | { type: 'devicesChanged'; count: number; connected: boolean }
  | { type: 'sessionChanged'; state: SessionState }
  | { type: 'voiceInvocationsChanged'; state: string }
  | { type: 'cameraChanged'; state: CameraState }
  | { type: 'cameraFrame'; width: number; height: number; timestampUs: number }
  | { type: 'speechChanged'; state: SpeechState; source: SpeechSource }
  | { type: 'speechResult'; result: SpeechResult }
  | { type: 'voiceInvocation'; invocation: VoiceInvocation }
  | { type: 'speechOutput'; event: SpeechOutputEvent }
  | { type: 'error'; error: NativeErrorEvent };

type Payload = Record<string, unknown>;

function asRecord(payload: unknown): Payload | null {
  return typeof payload === 'object' && payload !== null
    ? (payload as Payload)
    : null;
}

function str(payload: Payload, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}

function num(payload: Payload, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(payload: Payload, key: string): boolean | null {
  const value = payload[key];
  return typeof value === 'boolean' ? value : null;
}

function speechSource(value: string | null): SpeechSource | null {
  return value === 'glasses' || value === 'phone' ? value : null;
}

/**
 * Converts a raw native event into a typed event. Returns null for unknown names or malformed
 * payloads, so a bad payload is dropped instead of crashing the UI.
 */
export function mapNativeEvent(
  name: string,
  payload: unknown,
): MetaWearablesEvent | null {
  const data = asRecord(payload);
  if (!data) return null;

  switch (name) {
    case METAWEARABLES_EVENTS.registrationState: {
      const state = str(data, 'state');
      return state ? { type: 'registrationChanged', state } : null;
    }
    case METAWEARABLES_EVENTS.devices: {
      const count = num(data, 'count');
      const connected = bool(data, 'connected');
      return count !== null && connected !== null
        ? { type: 'devicesChanged', count, connected }
        : null;
    }
    case METAWEARABLES_EVENTS.sessionState: {
      const state = str(data, 'state');
      if (!state) return null;
      // The voice invocation stream reuses this channel with an "invocations:" prefix.
      if (state.startsWith('invocations:')) {
        return {
          type: 'voiceInvocationsChanged',
          state: state.slice('invocations:'.length),
        };
      }
      return { type: 'sessionChanged', state };
    }
    case METAWEARABLES_EVENTS.cameraState: {
      const state = str(data, 'state');
      return state ? { type: 'cameraChanged', state } : null;
    }
    case METAWEARABLES_EVENTS.cameraFrame: {
      const width = num(data, 'width');
      const height = num(data, 'height');
      const timestampUs = num(data, 'timestampUs');
      return width !== null && height !== null && timestampUs !== null
        ? { type: 'cameraFrame', width, height, timestampUs }
        : null;
    }
    case METAWEARABLES_EVENTS.speechState: {
      const state = str(data, 'state');
      const source = speechSource(str(data, 'source'));
      return state && source ? { type: 'speechChanged', state, source } : null;
    }
    case METAWEARABLES_EVENTS.speechResult: {
      const text = str(data, 'text');
      const isFinal = bool(data, 'isFinal');
      const confidence = num(data, 'confidence');
      const source = speechSource(str(data, 'source'));
      if (text === null || isFinal === null || confidence === null || !source)
        return null;
      return {
        type: 'speechResult',
        result: { text, isFinal, confidence, source },
      };
    }
    case METAWEARABLES_EVENTS.voiceInvocation: {
      const requestId = str(data, 'requestId');
      const type = str(data, 'type');
      if (!requestId || type !== 'launch_app') return null;
      return {
        type: 'voiceInvocation',
        invocation: { requestId, invocationType: 'launch_app' },
      };
    }
    case METAWEARABLES_EVENTS.speechOutput: {
      const utteranceId = str(data, 'utteranceId');
      const state = str(data, 'state');
      if (
        utteranceId === null ||
        (state !== 'started' && state !== 'done' && state !== 'error')
      )
        return null;
      const message = str(data, 'message') ?? undefined;
      return { type: 'speechOutput', event: { utteranceId, state, message } };
    }
    case METAWEARABLES_EVENTS.error: {
      const operation = str(data, 'operation');
      const message = str(data, 'message');
      return operation !== null && message !== null
        ? { type: 'error', error: { operation, message } }
        : null;
    }
    default:
      return null;
  }
}
