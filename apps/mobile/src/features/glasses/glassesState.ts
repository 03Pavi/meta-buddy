import type {
  CameraState,
  GlassesSnapshot,
  MetaWearablesEvent,
  PermissionStatus,
  RegistrationState,
  SessionState,
  SpeechState,
} from '../../../modules/meta-wearables/src';

export type PermissionKey = 'camera' | 'microphone';

export interface GlassesState {
  initialized: boolean;
  registration: RegistrationState;
  deviceCount: number;
  /** True when at least one device is visible to the SDK (Bluetooth-level connection). */
  deviceConnected: boolean;
  sessionState: SessionState;
  cameraState: CameraState;
  glassesSpeechState: SpeechState;
  voiceInvocationsActive: boolean;
  permissions: Record<PermissionKey, PermissionStatus | 'unknown'>;
  lastFrameAt?: number;
  lastError?: { operation: string; message: string };
  busy: boolean;
}

export const initialGlassesState: GlassesState = {
  initialized: false,
  registration: 'UNINITIALIZED',
  deviceCount: 0,
  deviceConnected: false,
  sessionState: 'NONE',
  cameraState: 'NONE',
  glassesSpeechState: 'NONE',
  voiceInvocationsActive: false,
  permissions: { camera: 'unknown', microphone: 'unknown' },
  busy: false,
};

export type GlassesAction =
  | { type: 'snapshotApplied'; snapshot: GlassesSnapshot }
  | { type: 'nativeEvent'; event: MetaWearablesEvent; now: number }
  | {
      type: 'permissionChanged';
      permission: PermissionKey;
      status: PermissionStatus;
    }
  | { type: 'busyChanged'; busy: boolean }
  | { type: 'errorReported'; operation: string; message: string }
  | { type: 'errorCleared' };

export function glassesReducer(
  state: GlassesState,
  action: GlassesAction,
): GlassesState {
  switch (action.type) {
    case 'snapshotApplied': {
      const { snapshot } = action;
      return {
        ...state,
        initialized: snapshot.initialized,
        registration: snapshot.registration,
        deviceCount: snapshot.deviceCount,
        deviceConnected: snapshot.deviceCount > 0,
        sessionState: snapshot.sessionState,
        cameraState: snapshot.cameraState,
        glassesSpeechState: snapshot.glassesSpeechState,
        voiceInvocationsActive: snapshot.voiceInvocationsActive,
      };
    }
    case 'nativeEvent':
      return applyNativeEvent(state, action.event, action.now);
    case 'permissionChanged':
      return {
        ...state,
        permissions: {
          ...state.permissions,
          [action.permission]: action.status,
        },
      };
    case 'busyChanged':
      return { ...state, busy: action.busy };
    case 'errorReported':
      return {
        ...state,
        lastError: { operation: action.operation, message: action.message },
      };
    case 'errorCleared':
      return { ...state, lastError: undefined };
    default:
      return state;
  }
}

function applyNativeEvent(
  state: GlassesState,
  event: MetaWearablesEvent,
  now: number,
): GlassesState {
  switch (event.type) {
    case 'registrationChanged':
      return { ...state, registration: event.state };
    case 'devicesChanged':
      return {
        ...state,
        deviceCount: event.count,
        deviceConnected: event.connected,
      };
    case 'sessionChanged':
      return { ...state, sessionState: event.state };
    case 'voiceInvocationsChanged':
      return { ...state, voiceInvocationsActive: event.state !== 'STOPPED' };
    case 'cameraChanged':
      return { ...state, cameraState: event.state };
    case 'cameraFrame':
      return { ...state, lastFrameAt: now };
    case 'speechChanged':
      return event.source === 'glasses'
        ? { ...state, glassesSpeechState: event.state }
        : state;
    case 'error':
      return {
        ...state,
        lastError: {
          operation: event.error.operation,
          message: event.error.message,
        },
      };
    default:
      return state;
  }
}

/** Plain-language summary of the connection, used on the home screen. */
export function connectionSummary(
  state: GlassesState,
):
  | 'unavailable'
  | 'not_registered'
  | 'no_device'
  | 'idle'
  | 'connected'
  | 'connecting' {
  if (!state.initialized) return 'unavailable';
  if (state.registration !== 'REGISTERED') return 'not_registered';
  if (state.sessionState === 'STARTED') return 'connected';
  if (state.sessionState === 'STARTING') return 'connecting';
  if (!state.deviceConnected) return 'no_device';
  return 'idle';
}
