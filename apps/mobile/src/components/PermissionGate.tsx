import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Modal, PermissionsAndroid, Platform, StyleSheet, View } from 'react-native';
import { modelStorageReady, requestModelStorage } from '../services/models/modelFile';
import { Text } from './AppText';
import { Button } from './ui';
import { radius, spacing, usePalette } from './theme';

/**
 * Asks for storage and microphone access when the app opens, if either is not allowed yet. Each one has its own
 * Allow button. "Not now" hides the sheet for this session; it appears again the next time the app opens.
 */
export function PermissionGate() {
  const palette = usePalette();
  const [storageOk, setStorageOk] = useState<boolean | null>(null);
  const [micOk, setMicOk] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // A check that fails counts as "not allowed", so the sheet still appears instead of waiting forever.
  const check = useCallback(() => {
    modelStorageReady()
      .then(setStorageOk)
      .catch(() => setStorageOk(false));
    if (Platform.OS === 'android') {
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
        .then(setMicOk)
        .catch(() => setMicOk(false));
    }
  }, []);

  useEffect(() => {
    check();
    // Coming back from the Android settings screen re-checks, so the sheet closes once access is switched on.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') check();
    });
    return () => subscription.remove();
  }, [check]);

  const missing = storageOk === false || micOk === false;
  const visible = missing && !dismissed;

  const allowStorage = async () => {
    await requestModelStorage();
    check();
  };

  const allowMicrophone = async () => {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    check();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setDismissed(true)}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.title, { color: palette.text }]}>Allow Buddy to work</Text>
          <Text style={[styles.body, { color: palette.mutedText }]}>
            Buddy needs these to run on this phone. You can change them later in Settings → Permissions.
          </Text>

          {storageOk === false ? (
            <View style={[styles.item, { borderColor: palette.border }]}>
              <Text style={[styles.itemTitle, { color: palette.text }]}>Storage for models</Text>
              <Text style={[styles.itemBody, { color: palette.mutedText }]}>
                Save and read the AI and speech models in the Download folder. On Android 11 and later, switch on “Allow
                access to manage all files” for Buddy, then come back.
              </Text>
              <Button label="Allow storage" variant="primary" onPress={allowStorage} />
            </View>
          ) : null}

          {micOk === false ? (
            <View style={[styles.item, { borderColor: palette.border }]}>
              <Text style={[styles.itemTitle, { color: palette.text }]}>Microphone</Text>
              <Text style={[styles.itemBody, { color: palette.mutedText }]}>
                Listen when you tap Speak or turn on voice mode. Nothing is recorded in the background.
              </Text>
              <Button label="Allow microphone" variant="primary" onPress={allowMicrophone} />
            </View>
          ) : null}

          <Button label="Not now" onPress={() => setDismissed(true)} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.6)' },
  sheet: {
    borderTopLeftRadius: radius.md * 3,
    borderTopRightRadius: radius.md * 3,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: { fontSize: 22, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 20 },
  item: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md * 2, padding: spacing.lg, gap: spacing.sm },
  itemTitle: { fontSize: 16, fontWeight: '600' },
  itemBody: { fontSize: 13, lineHeight: 18 },
});
