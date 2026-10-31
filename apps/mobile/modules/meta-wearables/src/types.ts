/**
 * Types for the Meta Wearables (DAT) native bridge.
 *
 * State values are strings copied from the SDK's enums. The `(string & {})` members keep the union
 * open, so a new SDK state reaches JS as a value rather than failing to parse.
 */

export type RegistrationState =
  | 'UNINITIALIZED'
  | 'UNAVAILABLE'
  | 'AVAILABLE'
  | 'REGISTERING'
  | 'REGISTERED'
  | 'UNREGISTERING'
  | (string & {});

export type SessionState =
  | 'NONE'
  | 'IDLE'
  | 'STARTING'
  | 'STARTED'
  | 'PAUSED'
  | 'STOPPING'
  | 'STOPPED'
  | (string & {});

export type CameraState =
  | 'NONE'
  | 'STOPPED'
  | 'STARTING'
  | 'STARTED'
  | 'STREAMING'
  | 'PAUSED'
  | 'STOPPING'
  | 'CLOSED'
  | (string & {});

export type SpeechState =
  | 'NONE'
  | 'STARTING'
  | 'STARTED'
  | 'STOPPING'
  | 'STOPPED'
  | (string & {});

export type PermissionName = 'camera' | 'microphone';
export type PermissionStatus = 'granted' | 'denied';

export type VideoQuality = 'LOW' | 'MEDIUM' | 'HIGH';

export interface CameraOptions {
  videoQuality?: VideoQuality;
  /** Valid values per the SDK: 2, 7, 15, 24, 30. */
  frameRate?: 2 | 7 | 15 | 24 | 30;
}

export interface GlassesSnapshot {
  initialized: boolean;
  registration: RegistrationState;
  deviceCount: number;
  sessionState: SessionState;
  cameraState: CameraState;
  glassesSpeechState: SpeechState;
  voiceInvocationsActive: boolean;
}

export interface PhotoCapture {
  mimeType: 'image/jpeg';
  base64: string;
  width: number;
  height: number;
}

export type SpeechSource = 'glasses' | 'phone';

export interface SpeechResult {
  text: string;
  isFinal: boolean;
  /** -1 when the SDK or recognizer did not report a score. */
  confidence: number;
  source: SpeechSource;
}

export interface VoiceInvocation {
  requestId: string;
  invocationType: 'launch_app';
}

export type SpeechOutputState = 'started' | 'done' | 'error';

export interface SpeechOutputEvent {
  utteranceId: string;
  state: SpeechOutputState;
  message?: string;
}

export interface NativeErrorEvent {
  operation: string;
  message: string;
}
