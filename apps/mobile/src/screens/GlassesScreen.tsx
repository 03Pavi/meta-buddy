import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Text } from '../components/AppText';
import { Button, Card, KeyValueRow, Notice } from '../components/ui';
import { spacing, usePalette } from '../components/theme';
import {
  connectionSummary,
  type PermissionKey,
} from '../features/glasses/glassesState';
import { isGlassesModuleAvailable } from '../../modules/meta-wearables/src';
import { useGlasses } from '../state/GlassesProvider';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Glasses'>;

const REGISTRATION_LABEL: Record<string, string> = {
  UNINITIALIZED: 'Not initialized',
  UNAVAILABLE: 'Unavailable',
  AVAILABLE: 'Not registered',
  REGISTERING: 'Registering…',
  REGISTERED: 'Registered',
  UNREGISTERING: 'Unregistering…',
};

const SESSION_LABEL: Record<string, string> = {
  NONE: 'No session',
  IDLE: 'Idle',
  STARTING: 'Starting…',
  STARTED: 'Connected',
  PAUSED: 'Paused by glasses',
  STOPPING: 'Stopping…',
  STOPPED: 'Stopped',
};

const CAMERA_LABEL: Record<string, string> = {
  NONE: 'Off',
  STOPPED: 'Off',
  STARTING: 'Starting…',
  STARTED: 'Ready',
  STREAMING: 'Streaming',
  PAUSED: 'Paused',
  STOPPING: 'Stopping…',
  CLOSED: 'Closed',
};

function label(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}

export function GlassesScreen(_props: Props) {
  const palette = usePalette();
  const { state, actions } = useGlasses();
  const connection = connectionSummary(state);
  const sessionConnected = state.sessionState === 'STARTED';
  const canConnect = state.registration === 'REGISTERED' && !state.busy;

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={styles.content}
    >
      {!isGlassesModuleAvailable ? (
        <Notice message="Glasses support needs the Android development build. The assistant still works with text." />
      ) : null}

      {state.lastError ? (
        <Notice
          message={`${state.lastError.operation}: ${state.lastError.message}`}
          onDismiss={actions.clearError}
        />
      ) : null}

      <Card title="Connection">
        <KeyValueRow
          label="Meta AI registration"
          value={label(REGISTRATION_LABEL, state.registration)}
          tone={state.registration === 'REGISTERED' ? 'success' : 'warning'}
        />
        <KeyValueRow
          label="Glasses visible"
          value={
            state.deviceCount > 0
              ? `${state.deviceCount} device${
                  state.deviceCount === 1 ? '' : 's'
                }`
              : 'None'
          }
          tone={state.deviceCount > 0 ? 'success' : 'neutral'}
        />
        <KeyValueRow
          label="Session"
          value={label(SESSION_LABEL, state.sessionState)}
          tone={sessionConnected ? 'success' : 'neutral'}
        />
        <Text style={[styles.hint, { color: palette.mutedText }]}>
          Status:{' '}
          {connection === 'connected'
            ? 'Session live'
            : connection.replace('_', ' ')}
          . A visible device does not mean the session is started.
        </Text>
        <View style={styles.buttons}>
          <Button
            label="Register with Meta AI"
            onPress={actions.register}
            disabled={state.busy || !state.initialized}
          />
          <Button
            label={sessionConnected ? 'Reconnect' : 'Connect'}
            variant="primary"
            onPress={actions.connect}
            disabled={!canConnect}
          />
          <Button
            label="Disconnect"
            variant="danger"
            onPress={actions.disconnect}
            disabled={state.busy || state.sessionState === 'NONE'}
          />
        </View>
      </Card>

      <Card title="Permissions">
        <PermissionRow
          permission="camera"
          status={state.permissions.camera}
          onRequest={actions.requestPermission}
          disabled={state.busy}
        />
        <PermissionRow
          permission="microphone"
          status={state.permissions.microphone}
          onRequest={actions.requestPermission}
          disabled={state.busy}
        />
        <Text style={[styles.hint, { color: palette.mutedText }]}>
          Permissions are granted by the wearer in the Meta AI app. Choose
          “Allow once” or “Allow always” there.
        </Text>
      </Card>

      <Card title="Active capabilities">
        <KeyValueRow
          label="Camera"
          value={label(CAMERA_LABEL, state.cameraState)}
          tone={state.cameraState === 'STREAMING' ? 'danger' : 'neutral'}
        />
        <KeyValueRow
          label="Glasses speech (dev/beta)"
          value={
            state.glassesSpeechState === 'NONE'
              ? 'Off'
              : state.glassesSpeechState
          }
        />
        <KeyValueRow
          label="Voice invocations (dev/beta)"
          value={
            state.voiceInvocationsActive ? 'Listening for “Hey Meta”' : 'Off'
          }
        />
        <View style={styles.buttons}>
          <Button
            label="Stop camera"
            onPress={actions.stopCamera}
            disabled={
              state.busy ||
              state.cameraState === 'NONE' ||
              state.cameraState === 'STOPPED'
            }
          />
          <Button
            label={
              state.voiceInvocationsActive
                ? 'Stop voice invocations'
                : 'Start voice invocations'
            }
            onPress={
              state.voiceInvocationsActive
                ? actions.stopVoiceInvocations
                : actions.startVoiceInvocations
            }
            disabled={state.busy || !state.initialized}
          />
        </View>
      </Card>

      <Text style={[styles.footnote, { color: palette.mutedText }]}>
        Speech and voice invocations use SDK capabilities that are dev and beta
        only. They are not available in production release channels yet. See the
        README for details.
      </Text>
    </ScrollView>
  );
}

function PermissionRow({
  permission,
  status,
  onRequest,
  disabled,
}: {
  permission: PermissionKey;
  status: string;
  onRequest: (permission: PermissionKey) => Promise<void>;
  disabled: boolean;
}) {
  const title = permission === 'camera' ? 'Camera' : 'Microphone';
  return (
    <View style={styles.permissionRow}>
      <KeyValueRow
        label={title}
        value={status === 'unknown' ? 'Not checked' : status}
        tone={status === 'granted' ? 'success' : 'neutral'}
      />
      <Button
        label={`Request ${title.toLowerCase()}`}
        onPress={() => onRequest(permission)}
        disabled={disabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  hint: { fontSize: 13, lineHeight: 18 },
  footnote: { fontSize: 13, lineHeight: 18 },
  buttons: { gap: spacing.sm },
  permissionRow: { gap: spacing.sm },
});
