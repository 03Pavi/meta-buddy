import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomDock, DOCK_SPACE } from '../components/BottomDock';
import { spacing, usePalette } from '../components/theme';
import { Text } from '../components/AppText';
import { Button, Card } from '../components/ui';
import type { SpeechInputSource } from '../services/settings/settingsStore';
import { useAssistant } from '../state/AssistantProvider';
import { useSettings } from '../state/SettingsProvider';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const SPEECH_OPTIONS: Array<{ value: SpeechInputSource; label: string }> = [
  { value: 'glasses', label: 'Glasses mic' },
  { value: 'phone', label: 'Phone mic' },
  { value: 'text', label: 'Off' },
];

const QUALITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH'] as const;
const FRAME_RATE_OPTIONS = [15, 24] as const;

export function SettingsScreen(_props: Props) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { settings, update } = useSettings();
  const { actions } = useAssistant();

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <ScrollView
        style={{ backgroundColor: palette.background }}
        contentContainerStyle={[styles.content, { paddingBottom: DOCK_SPACE + insets.bottom }]}
      >
        <Card title="Speech input">
          <View style={styles.segmented}>
            {SPEECH_OPTIONS.map(option => (
              <Button
                key={option.value}
                label={option.label}
                variant={settings.speechInput === option.value ? 'primary' : 'secondary'}
                onPress={() => update({ speechInput: option.value })}
              />
            ))}
          </View>
          <Text style={[styles.hint, { color: palette.mutedText }]}>
            “Phone mic” uses the phone's speech recognizer. Glasses speech is a dev/beta SDK feature. The app never switches
            sources silently.
          </Text>
        </Card>

        <Card title="Replies and history">
          <ToggleRow label="Speak replies" value={settings.spokenReplies} onChange={value => update({ spokenReplies: value })} />
          <ToggleRow
            label="Keep conversation history"
            value={settings.keepHistory}
            onChange={value => update({ keepHistory: value })}
          />
          <Text style={[styles.hint, { color: palette.mutedText }]}>
            History stays on this device, and only text is kept.
          </Text>
          <Button label="Clear conversation" variant="danger" onPress={() => actions.clearConversation()} />
        </Card>

        <Card title="Glasses camera (for a future vision model)">
          <Text style={[styles.label, { color: palette.mutedText }]}>Quality</Text>
          <View style={styles.segmented}>
            {QUALITY_OPTIONS.map(quality => (
              <Button
                key={quality}
                label={quality}
                variant={settings.cameraQuality === quality ? 'primary' : 'secondary'}
                onPress={() => update({ cameraQuality: quality })}
              />
            ))}
          </View>
          <Text style={[styles.label, { color: palette.mutedText }]}>Frame rate</Text>
          <View style={styles.segmented}>
            {FRAME_RATE_OPTIONS.map(rate => (
              <Button
                key={rate}
                label={`${rate} fps`}
                variant={settings.cameraFrameRate === rate ? 'primary' : 'secondary'}
                onPress={() => update({ cameraFrameRate: rate })}
              />
            ))}
          </View>
          <Text style={[styles.hint, { color: palette.mutedText }]}>
            The on-device models are text-only, so the camera is not used for answers yet.
          </Text>
        </Card>

        <Card title="Hands-free (dev/beta)">
          <ToggleRow
            label="Listen for “Hey Meta, start Buddy”"
            value={settings.voiceInvocations}
            onChange={value => update({ voiceInvocations: value })}
          />
          <Text style={[styles.hint, { color: palette.mutedText }]}>
            Requires the Voice Invocations permission in the Wearables Developer Center. It works only in dev and beta channels.
          </Text>
        </Card>
      </ScrollView>
      <BottomDock active="Settings" />
    </View>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  const palette = usePalette();
  return (
    <View style={styles.toggleRow}>
      <Text style={[styles.toggleLabel, { color: palette.text }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  label: { fontSize: 13, fontWeight: '600' },
  hint: { fontSize: 13, lineHeight: 18 },
  segmented: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  toggleLabel: { fontSize: 15, flex: 1 },
});
