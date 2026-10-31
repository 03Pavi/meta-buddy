import {
  mapNativeEvent,
  METAWEARABLES_EVENTS,
} from '../modules/meta-wearables/src/events';

describe('mapNativeEvent (native bridge event mapping)', () => {
  it('maps registration and device changes', () => {
    expect(
      mapNativeEvent(METAWEARABLES_EVENTS.registrationState, {
        state: 'REGISTERED',
      }),
    ).toEqual({
      type: 'registrationChanged',
      state: 'REGISTERED',
    });
    expect(
      mapNativeEvent(METAWEARABLES_EVENTS.devices, {
        count: 1,
        connected: true,
      }),
    ).toEqual({
      type: 'devicesChanged',
      count: 1,
      connected: true,
    });
  });

  it('maps session and camera state', () => {
    expect(
      mapNativeEvent(METAWEARABLES_EVENTS.sessionState, { state: 'STARTED' }),
    ).toEqual({
      type: 'sessionChanged',
      state: 'STARTED',
    });
    expect(
      mapNativeEvent(METAWEARABLES_EVENTS.cameraState, { state: 'STREAMING' }),
    ).toEqual({
      type: 'cameraChanged',
      state: 'STREAMING',
    });
    expect(
      mapNativeEvent(METAWEARABLES_EVENTS.cameraFrame, {
        width: 504,
        height: 896,
        timestampUs: 1234,
      }),
    ).toEqual({
      type: 'cameraFrame',
      width: 504,
      height: 896,
      timestampUs: 1234,
    });
  });

  it('routes voice-invocation stream states away from the session channel', () => {
    expect(
      mapNativeEvent(METAWEARABLES_EVENTS.sessionState, {
        state: 'invocations:STARTED',
      }),
    ).toEqual({
      type: 'voiceInvocationsChanged',
      state: 'STARTED',
    });
  });

  it('maps speech results and keeps the source', () => {
    expect(
      mapNativeEvent(METAWEARABLES_EVENTS.speechResult, {
        text: 'hello',
        isFinal: false,
        confidence: -1,
        source: 'phone',
      }),
    ).toEqual({
      type: 'speechResult',
      result: {
        text: 'hello',
        isFinal: false,
        confidence: -1,
        source: 'phone',
      },
    });
  });

  it('maps voice invocations and only accepts the launch_app type', () => {
    expect(
      mapNativeEvent(METAWEARABLES_EVENTS.voiceInvocation, {
        requestId: 'r1',
        type: 'launch_app',
      }),
    ).toEqual({
      type: 'voiceInvocation',
      invocation: { requestId: 'r1', invocationType: 'launch_app' },
    });
    expect(
      mapNativeEvent(METAWEARABLES_EVENTS.voiceInvocation, {
        requestId: 'r1',
        type: 'other',
      }),
    ).toBeNull();
  });

  it('maps speech output lifecycle', () => {
    expect(
      mapNativeEvent(METAWEARABLES_EVENTS.speechOutput, {
        utteranceId: 'u1',
        state: 'done',
      }),
    ).toEqual({
      type: 'speechOutput',
      event: { utteranceId: 'u1', state: 'done', message: undefined },
    });
    expect(
      mapNativeEvent(METAWEARABLES_EVENTS.speechOutput, {
        utteranceId: 'u1',
        state: 'exploded',
      }),
    ).toBeNull();
  });

  it('maps errors with operation context', () => {
    expect(
      mapNativeEvent(METAWEARABLES_EVENTS.error, {
        operation: 'camera',
        message: 'denied',
      }),
    ).toEqual({
      type: 'error',
      error: { operation: 'camera', message: 'denied' },
    });
  });

  it('drops malformed payloads and unknown event names instead of throwing', () => {
    expect(
      mapNativeEvent(METAWEARABLES_EVENTS.devices, { count: 'many' }),
    ).toBeNull();
    expect(
      mapNativeEvent(METAWEARABLES_EVENTS.cameraFrame, {
        width: Number.NaN,
        height: 1,
        timestampUs: 1,
      }),
    ).toBeNull();
    expect(mapNativeEvent(METAWEARABLES_EVENTS.error, null)).toBeNull();
    expect(
      mapNativeEvent(METAWEARABLES_EVENTS.error, 'not an object'),
    ).toBeNull();
    expect(mapNativeEvent('MetaWearables.unknown', { state: 'X' })).toBeNull();
  });
});
