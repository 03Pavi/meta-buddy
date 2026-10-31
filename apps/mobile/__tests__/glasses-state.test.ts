import {
  connectionSummary,
  glassesReducer,
  initialGlassesState,
} from '../src/features/glasses/glassesState';

describe('glassesReducer', () => {
  it('applies a snapshot and derives device connectivity from the device count', () => {
    const state = glassesReducer(initialGlassesState, {
      type: 'snapshotApplied',
      snapshot: {
        initialized: true,
        registration: 'REGISTERED',
        deviceCount: 1,
        sessionState: 'STARTED',
        cameraState: 'NONE',
        glassesSpeechState: 'NONE',
        voiceInvocationsActive: false,
      },
    });
    expect(state.deviceConnected).toBe(true);
    expect(state.registration).toBe('REGISTERED');
    expect(connectionSummary(state)).toBe('connected');
  });

  it('applies native events to the matching fields', () => {
    let state = glassesReducer(initialGlassesState, {
      type: 'nativeEvent',
      event: { type: 'cameraChanged', state: 'STREAMING' },
      now: 0,
    });
    expect(state.cameraState).toBe('STREAMING');

    state = glassesReducer(state, {
      type: 'nativeEvent',
      event: { type: 'cameraFrame', width: 1, height: 1, timestampUs: 1 },
      now: 500,
    });
    expect(state.lastFrameAt).toBe(500);

    state = glassesReducer(state, {
      type: 'nativeEvent',
      event: { type: 'speechChanged', state: 'STARTED', source: 'phone' },
      now: 0,
    });
    // Phone speech state does not change the glasses speech state.
    expect(state.glassesSpeechState).toBe('NONE');
  });

  it('records native errors with their operation', () => {
    const state = glassesReducer(initialGlassesState, {
      type: 'nativeEvent',
      event: {
        type: 'error',
        error: { operation: 'session', message: 'Session lost' },
      },
      now: 0,
    });
    expect(state.lastError).toEqual({
      operation: 'session',
      message: 'Session lost',
    });
  });

  it('tracks permission status per capability', () => {
    const state = glassesReducer(initialGlassesState, {
      type: 'permissionChanged',
      permission: 'camera',
      status: 'granted',
    });
    expect(state.permissions).toEqual({
      camera: 'granted',
      microphone: 'unknown',
    });
  });
});

describe('connectionSummary', () => {
  it('says what the user needs to do next', () => {
    expect(connectionSummary(initialGlassesState)).toBe('unavailable');
    expect(
      connectionSummary({
        ...initialGlassesState,
        initialized: true,
        registration: 'AVAILABLE',
      }),
    ).toBe('not_registered');
    expect(
      connectionSummary({
        ...initialGlassesState,
        initialized: true,
        registration: 'REGISTERED',
      }),
    ).toBe('no_device');
    expect(
      connectionSummary({
        ...initialGlassesState,
        initialized: true,
        registration: 'REGISTERED',
        deviceConnected: true,
      }),
    ).toBe('idle');
    expect(
      connectionSummary({
        ...initialGlassesState,
        initialized: true,
        registration: 'REGISTERED',
        sessionState: 'STARTING',
      }),
    ).toBe('connecting');
  });
});
