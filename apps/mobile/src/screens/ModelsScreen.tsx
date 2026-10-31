import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomDock, DOCK_SPACE } from '../components/BottomDock';
import { radius, spacing, usePalette } from '../components/theme';
import { Text } from '../components/AppText';
import { Button, Card, KeyValueRow } from '../components/ui';
import { findModel, formatModelSize, LOCAL_MODELS, type LocalModel } from '../services/models/catalog';
import { SPEECH_RATES } from '../services/settings/settingsStore';
import {
  checkModelFile,
  defaultModelPath,
  ensureModelFolder,
  modelAtPath,
  modelOnPhone,
  type ModelFileStatus,
  modelStorageReady,
  moveLegacyModels,
  partialModelProgress,
  requestModelStorage,
  suggestedModelLocations,
} from '../services/models/modelFile';
import { SHARED_MODELS_DIRECTORY } from '../services/models/storage';
import { isVoiceModelReady, partialVoiceModelProgress } from '../services/speech/voiceModelFile';
import { VOICE_MODELS } from '../services/speech/voiceModels';
import type { RootStackParamList } from '../navigation/types';
import { useModelDownloads } from '../state/ModelDownloadProvider';
import { useSettings } from '../state/SettingsProvider';

type Props = NativeStackScreenProps<RootStackParamList, 'Models'>;

/** Models tab: download, choose and check the on-device model. */
export function ModelsScreen(_props: Props) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { settings, update } = useSettings();
  const activeModel = findModel(settings.modelId);
  const [modelPathDraft, setModelPathDraft] = useState(settings.modelPath);
  const [modelStatus, setModelStatus] = useState<ModelFileStatus | null>(null);
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const { active, error: downloadError, finishedCount, start, startSpeech, retry, cancel } = useModelDownloads();
  const [storageReady, setStorageReady] = useState<boolean | null>(null);
  const [voiceReady, setVoiceReady] = useState<Record<string, boolean>>({});
  // Where the active model can be found, with what Buddy sees at each place.
  const [locations, setLocations] = useState<Array<{ path: string; status: 'yes' | 'no' | 'needs-access' }>>([]);
  // Share of each model already saved, so a stopped download can be offered as Resume.
  const [partial, setPartial] = useState<Record<string, number>>({});

  const refreshDownloads = async () => {
    const states = await Promise.all(LOCAL_MODELS.map(async model => [model.id, await modelOnPhone(model)] as const));
    setDownloaded(Object.fromEntries(states.map(([id, state]) => [id, state === 'yes'])));
    // A file the app cannot see means storage access is missing, so ask for it.
    if (states.some(([, state]) => state === 'needs-access')) setStorageReady(false);
  };

  const refreshModelStatus = async (configured: string, model: LocalModel) => {
    setModelStatus(await checkModelFile(configured, model));
  };

  // Switching models clears any custom file location, so the chosen model's own file is used.
  const useModel = (model: LocalModel) => {
    update({ modelId: model.id, modelPath: '' });
    setModelPathDraft('');
    refreshModelStatus('', model);
  };

  useEffect(() => {
    refreshDownloads();
    modelStorageReady().then(ready => {
      setStorageReady(ready);
      if (ready) moveLegacyModels().then(refreshDownloads);
    });
    // Check once when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshModelStatus(settings.modelPath, activeModel);
    // A custom location that cannot be read is replaced by the default one when the model is there, so the
    // error clears without the user having to act.
    if (settings.modelPath) {
      Promise.all([
        modelAtPath(settings.modelPath, activeModel),
        modelAtPath(defaultModelPath(activeModel), activeModel),
      ]).then(([custom, fallback]) => {
        if (custom !== 'yes' && fallback === 'yes') {
          update({ modelPath: '' });
          setModelPathDraft('');
        }
      });
    }
    // Recheck when the active model or its location changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.modelId, settings.modelPath]);

  // A download can finish while this screen is closed, so reload the list when it comes back or a download ends.
  useEffect(() => {
    refreshDownloads();
    refreshModelStatus(settings.modelPath, activeModel);
    Promise.all(VOICE_MODELS.map(async model => [model.id, await isVoiceModelReady(model)] as const)).then(entries =>
      setVoiceReady(Object.fromEntries(entries)),
    );
    ensureModelFolder();
    Promise.all(
      suggestedModelLocations(activeModel).map(async path => ({
        path,
        status: await modelAtPath(path, activeModel),
      })),
    ).then(setLocations);
    Promise.all([
      ...LOCAL_MODELS.map(async model => [model.id, await partialModelProgress(model)] as const),
      ...VOICE_MODELS.map(async model => [model.id, await partialVoiceModelProgress(model)] as const),
    ]).then(entries => setPartial(Object.fromEntries(entries)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedCount]);

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: DOCK_SPACE + insets.bottom }]}
      >
        <Card title="Storage">
          <KeyValueRow label="Folder" value={SHARED_MODELS_DIRECTORY} />
          <KeyValueRow
            label="Access"
            value={storageReady === true ? 'Allowed' : 'Not allowed yet'}
            tone={storageReady === true ? 'success' : 'warning'}
          />
          <Text style={[styles.hint, { color: palette.mutedText }]}>
            Buddy needs permission to save models in the Download folder, so they stay on the phone if the app is removed.
            On Android 11 and later, tap Allow, switch on “Allow access to manage all files” for Buddy, then come back and
            tap Check access.
          </Text>
          {storageReady === true ? null : (
            <Button
              label="Allow storage access"
              variant="primary"
              onPress={() => requestModelStorage().then(setStorageReady)}
            />
          )}
          <Button label="Check access" onPress={() => modelStorageReady().then(setStorageReady)} />
        </Card>

        <Card title="AI model">
          <Text style={[styles.hint, { color: palette.mutedText }]}>
            Replies are generated on this phone, with no server. Download a model once. It needs Wi-Fi and free storage for
            the file size shown. Each model is published under its own licence. A download keeps going when you open other
            screens. If Android closes Buddy in the background, start the download again and it will restart.
          </Text>

          {LOCAL_MODELS.map(model => {
            const isActive = model.id === settings.modelId;
            const isDownloaded = downloaded[model.id] === true;
            const isDownloading = active?.modelId === model.id;
            return (
              <View key={model.id} style={[styles.modelRow, { borderColor: palette.border }]}>
                <Text style={[styles.modelTitle, { color: palette.text }]}>
                  {model.label}
                  {isActive ? '  · In use' : ''}
                </Text>
                <Text style={[styles.hint, { color: palette.mutedText }]}>
                  {formatModelSize(model.sizeBytes)} · {isDownloaded ? 'Downloaded' : 'Not downloaded'}
                </Text>
                <Text style={[styles.hint, { color: palette.mutedText }]}>{model.note}</Text>
                <Text style={[styles.hint, { color: palette.mutedText }]}>Licence: {model.license}</Text>
                {isDownloading ? (
                  <Button
                    label={`Downloading… ${Math.round((active?.progress ?? 0) * 100)}%`}
                    variant="danger"
                    onPress={cancel}
                  />
                ) : (
                  <View style={styles.buttons}>
                    {!isDownloaded ? (
                      <Button
                        label={resumeLabel(partial[model.id], `Download (${formatModelSize(model.sizeBytes)})`)}
                        variant="primary"
                        onPress={() => start(model)}
                        disabled={active !== null || storageReady !== true}
                      />
                    ) : null}
                    {isDownloaded && !isActive ? (
                      <Button label="Use this model" variant="primary" onPress={() => useModel(model)} />
                    ) : null}
                  </View>
                )}
              </View>
            );
          })}
          {downloadError ? <Text style={[styles.hint, { color: palette.danger }]}>{downloadError}</Text> : null}
          {downloadError ? <Button label="Retry" variant="primary" onPress={retry} /> : null}

          <Text style={[styles.label, { color: palette.mutedText }]}>Where Buddy looks for {activeModel.label}</Text>
          {locations.map(location => {
            const inUse = settings.modelPath === location.path || (!settings.modelPath && location.path === defaultModelPath(activeModel));
            return (
              <View key={location.path} style={[styles.modelRow, { borderColor: palette.border }]}>
                <Text style={[styles.hint, { color: palette.text }]}>{location.path}</Text>
                <Text style={[styles.hint, { color: palette.mutedText }]}>
                  {location.status === 'yes'
                    ? 'Model file found'
                    : location.status === 'needs-access'
                      ? 'Buddy cannot see this location yet'
                      : 'No model here'}
                  {inUse ? ' · In use' : ''}
                </Text>
                {location.status === 'yes' && !inUse ? (
                  <Button
                    label="Use this location"
                    variant="primary"
                    onPress={() => {
                      const choice = location.path === defaultModelPath(activeModel) ? '' : location.path;
                      update({ modelPath: choice });
                      setModelPathDraft(choice);
                    }}
                  />
                ) : null}
              </View>
            );
          })}
          <Text style={[styles.hint, { color: palette.mutedText }]}>
            Buddy creates the default folder for you. Copy the model file into it, or into another location listed above,
            and Buddy will find it.
          </Text>

          <Text style={[styles.label, { color: palette.mutedText }]}>
            Custom file location for {activeModel.label} (optional)
          </Text>
          <TextInput
            value={modelPathDraft}
            onChangeText={setModelPathDraft}
            placeholder={defaultModelPath(activeModel)}
            placeholderTextColor={palette.mutedText}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { color: palette.text, borderColor: palette.border }]}
            accessibilityLabel="Model file location"
          />
          <View style={styles.buttons}>
            <Button
              label="Save and check model"
              variant="primary"
              onPress={() => {
                update({ modelPath: modelPathDraft.trim() });
                refreshModelStatus(modelPathDraft, activeModel);
              }}
              disabled={modelPathDraft.trim() === settings.modelPath}
            />
            <Button label="Check model file" onPress={() => refreshModelStatus(settings.modelPath, activeModel)} />
          </View>
          {modelStatus ? (
            <KeyValueRow
              label="Model file"
              value={
                modelStatus.valid
                  ? `Ready · ${Math.round((modelStatus.sizeBytes ?? 0) / 1e6)} MB`
                  : (modelStatus.problem ?? 'Not found')
              }
              tone={modelStatus.valid ? 'success' : 'warning'}
            />
          ) : null}
          <Text style={[styles.hint, { color: palette.mutedText }]}>
            Models are saved in Download/Buddy/models on this phone. To use a model file you already have, copy it into that
            folder, or set a custom file location above.
          </Text>
        </Card>
        <Card title="Voice models (offline speech)">
          <Text style={[styles.hint, { color: palette.mutedText }]}>
            Speech input can use a model stored on this phone instead of the phone's own recognizer. Audio stays on the
            phone. Download once. It uses the same storage access as the chat model.
          </Text>

          {VOICE_MODELS.map(model => {
            const isDownloaded = voiceReady[model.id] === true;
            const isDownloading = active?.kind === 'speech' && active.modelId === model.id;
            return (
              <View key={model.id} style={[styles.modelRow, { borderColor: palette.border }]}>
                <Text style={[styles.modelTitle, { color: palette.text }]}>{model.label}</Text>
                <Text style={[styles.hint, { color: palette.mutedText }]}>
                  {formatModelSize(model.sizeBytes)} · {isDownloaded ? 'Downloaded' : 'Not downloaded'}
                </Text>
                <Text style={[styles.hint, { color: palette.mutedText }]}>{model.note}</Text>
                <Text style={[styles.hint, { color: palette.mutedText }]}>Licence: {model.license}</Text>
                {isDownloading ? (
                  <Button
                    label={`Downloading… ${Math.round((active?.progress ?? 0) * 100)}%`}
                    variant="danger"
                    onPress={cancel}
                  />
                ) : !isDownloaded ? (
                  <Button
                    label={resumeLabel(partial[model.id], `Download (${formatModelSize(model.sizeBytes)})`)}
                    variant="primary"
                    onPress={() => startSpeech(model)}
                    disabled={active !== null || storageReady !== true}
                  />
                ) : null}
              </View>
            );
          })}

          {downloadError ? <Text style={[styles.hint, { color: palette.danger }]}>{downloadError}</Text> : null}
          {downloadError ? <Button label="Retry" variant="primary" onPress={retry} /> : null}

          <Text style={[styles.label, { color: palette.mutedText }]}>Playback speed for spoken replies</Text>
          <View style={styles.segmented}>
            {SPEECH_RATES.map(rate => (
              <Button
                key={rate}
                label={`${rate}x`}
                variant={settings.speechRate === rate ? 'primary' : 'secondary'}
                onPress={() => update({ speechRate: rate })}
              />
            ))}
          </View>

          <View style={styles.toggleRow}>
            <Text style={[styles.toggleLabel, { color: palette.text }]}>Use offline speech</Text>
            <Switch
              value={settings.offlineSpeech}
              onValueChange={value => update({ offlineSpeech: value })}
              disabled={voiceReady[VOICE_MODELS[0].id] !== true && !settings.offlineSpeech}
              accessibilityLabel="Use offline speech"
            />
          </View>
          <Text style={[styles.hint, { color: palette.mutedText }]}>
            Turn this on after the speech model is downloaded. Off uses the phone's recognizer.
          </Text>
        </Card>
      </ScrollView>
      <BottomDock active="Models" />
    </View>
  );
}

/** Button text: "Resume (45%)" when part of the file is already saved, otherwise the normal download label. */
function resumeLabel(progress: number | undefined, fallback: string): string {
  return progress && progress > 0 ? `Resume (${Math.round(progress * 100)}%)` : fallback;
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  label: { fontSize: 13, fontWeight: '600' },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  hint: { fontSize: 13, lineHeight: 18 },
  modelRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  modelTitle: { fontSize: 15, fontWeight: '600' },
  buttons: { gap: spacing.sm },
  segmented: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  toggleLabel: { fontSize: 15, flex: 1 },
});
