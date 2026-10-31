import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  GlassesError,
  GlassesUnavailableError,
  MetaWearables,
  type CameraOptions,
  type PhotoCapture,
} from '../../modules/meta-wearables/src';
import {
  glassesReducer,
  initialGlassesState,
  type GlassesState,
  type PermissionKey,
} from '../features/glasses/glassesState';

export interface GlassesActions {
  initialize: () => Promise<void>;
  register: () => Promise<void>;
  unregister: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  requestPermission: (permission: PermissionKey) => Promise<void>;
  startCamera: (options?: CameraOptions) => Promise<boolean>;
  stopCamera: () => Promise<void>;
  capturePhoto: () => Promise<PhotoCapture | null>;
  stopGlassesSpeech: () => Promise<void>;
  startVoiceInvocations: () => Promise<void>;
  stopVoiceInvocations: () => Promise<void>;
  clearError: () => void;
}

interface GlassesContextValue {
  state: GlassesState;
  actions: GlassesActions;
}

const GlassesContext = createContext<GlassesContextValue | null>(null);

/** Keeps the caller's operation label and a readable message. Native error codes stay in the message text. */
function describeError(
  operation: string,
  error: unknown,
): { operation: string; message: string } {
  if (
    error instanceof GlassesUnavailableError ||
    error instanceof GlassesError
  ) {
    return { operation, message: error.message };
  }
  return {
    operation,
    message: error instanceof Error ? error.message : 'Unexpected error',
  };
}

/**
 * Owns the glasses connection state, fed by native events, and exposes the actions the screens call.
 * Camera and microphone are stopped when the app leaves the foreground, so they never run unnecessarily.
 */
export function GlassesProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(glassesReducer, initialGlassesState);
  const busyRef = useRef(false);

  const run = useCallback(
    async <T,>(
      operation: string,
      task: () => Promise<T>,
    ): Promise<T | undefined> => {
      if (busyRef.current) return undefined;
      busyRef.current = true;
      dispatch({ type: 'busyChanged', busy: true });
      try {
        return await task();
      } catch (error) {
        dispatch({ type: 'errorReported', ...describeError(operation, error) });
        return undefined;
      } finally {
        busyRef.current = false;
        dispatch({ type: 'busyChanged', busy: false });
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!MetaWearables.available) return;
    try {
      dispatch({
        type: 'snapshotApplied',
        snapshot: await MetaWearables.getSnapshot(),
      });
    } catch (error) {
      dispatch({ type: 'errorReported', ...describeError('snapshot', error) });
    }
  }, []);

  // Native events keep the state current.
  useEffect(() => {
    const unsubscribe = MetaWearables.subscribe(event => {
      dispatch({ type: 'nativeEvent', event, now: Date.now() });
    });
    return unsubscribe;
  }, []);

  // Stop the camera and glasses microphone when the app goes to the background.
  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      if (status === 'background' || status === 'inactive') {
        MetaWearables.stopCamera().catch(() => undefined);
        MetaWearables.stopGlassesSpeech().catch(() => undefined);
      }
      if (status === 'active') {
        refresh();
      }
    };
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, [refresh]);

  const actions = useMemo<GlassesActions>(
    () => ({
      initialize: async () => {
        await run('initialize', async () => {
          dispatch({
            type: 'snapshotApplied',
            snapshot: await MetaWearables.initialize(),
          });
        });
      },
      register: async () => {
        await run('registration', () => MetaWearables.startRegistration());
        await refresh();
      },
      unregister: async () => {
        await run('registration', () => MetaWearables.startUnregistration());
        await refresh();
      },
      connect: async () => {
        await run('session', async () => {
          dispatch({
            type: 'snapshotApplied',
            snapshot: await MetaWearables.connect(),
          });
        });
      },
      disconnect: async () => {
        await run('session', async () => {
          dispatch({
            type: 'snapshotApplied',
            snapshot: await MetaWearables.disconnect(),
          });
        });
      },
      requestPermission: async permission => {
        await run('permission', async () => {
          const status = await MetaWearables.requestPermission(permission);
          dispatch({ type: 'permissionChanged', permission, status });
        });
      },
      startCamera: async options => {
        const result = await run('camera', async () => {
          dispatch({
            type: 'snapshotApplied',
            snapshot: await MetaWearables.startCamera(options),
          });
          return true;
        });
        return result === true;
      },
      stopCamera: async () => {
        await run('camera', async () => {
          dispatch({
            type: 'snapshotApplied',
            snapshot: await MetaWearables.stopCamera(),
          });
        });
      },
      capturePhoto: async () => {
        const photo = await run('camera', () => MetaWearables.capturePhoto());
        return photo ?? null;
      },
      stopGlassesSpeech: async () => {
        await run('speech', async () => {
          dispatch({
            type: 'snapshotApplied',
            snapshot: await MetaWearables.stopGlassesSpeech(),
          });
        });
      },
      startVoiceInvocations: async () => {
        await run('voiceInvocations', async () => {
          dispatch({
            type: 'snapshotApplied',
            snapshot: await MetaWearables.startVoiceInvocations(),
          });
        });
      },
      stopVoiceInvocations: async () => {
        await run('voiceInvocations', async () => {
          dispatch({
            type: 'snapshotApplied',
            snapshot: await MetaWearables.stopVoiceInvocations(),
          });
        });
      },
      clearError: () => dispatch({ type: 'errorCleared' }),
    }),
    [refresh, run],
  );

  const value = useMemo(() => ({ state, actions }), [state, actions]);
  return (
    <GlassesContext.Provider value={value}>{children}</GlassesContext.Provider>
  );
}

export function useGlasses(): GlassesContextValue {
  const context = useContext(GlassesContext);
  if (!context)
    throw new Error('useGlasses must be used inside GlassesProvider');
  return context;
}
