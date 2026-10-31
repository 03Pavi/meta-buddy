/** An offline speech model (Vosk). It is downloaded once, unpacked, and used without any network access. */
export interface VoiceModel {
  id: string;
  label: string;
  /** Folder the zip unpacks to. The model is read from here. */
  folderName: string;
  /** Public file from the Vosk model page. No login is needed. */
  url: string;
  /** Exact size of the zip in bytes, used to catch a cut-off download. */
  sizeBytes: number;
  note: string;
  license: string;
}

export const VOICE_MODELS: readonly VoiceModel[] = [
  {
    id: 'vosk-en-small',
    label: 'English, small (offline)',
    folderName: 'vosk-model-small-en-us-0.15',
    url: 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip',
    sizeBytes: 41205931,
    note: 'Works with no internet. Best for short questions. Less accurate than the phone recognizer for long speech.',
    license: 'Apache-2.0',
  },
];

/** Shared folder for speech models, so they stay on the phone if the app is removed. */
export const SHARED_VOICE_DIRECTORY = '/storage/emulated/0/Download/Buddy/voice';

export function voiceModelPath(model: VoiceModel): string {
  return `${SHARED_VOICE_DIRECTORY}/${model.folderName}`;
}
