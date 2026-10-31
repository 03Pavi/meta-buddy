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
  {
    id: 'vosk-hi-small',
    label: 'Hindi, small (offline)',
    folderName: 'vosk-model-small-hi-0.22',
    url: 'https://alphacephei.com/vosk/models/vosk-model-small-hi-0.22.zip',
    sizeBytes: 44458845,
    note: 'Works with no internet. Understands spoken Hindi. Hinglish in Roman letters may be less accurate.',
    license: 'Apache-2.0',
  },
];

/** The app's own folder for speech models. It needs no storage permission. */
export const SHARED_VOICE_DIRECTORY = '/storage/emulated/0/Android/data/com.buddy/files/voice';

export const DEFAULT_VOICE_MODEL_ID = 'vosk-en-small';

/** The speech model with this id, or the default one when the id is unknown. */
export function findVoiceModel(id: string): VoiceModel {
  return VOICE_MODELS.find(model => model.id === id) ?? VOICE_MODELS[0];
}

export function voiceModelPath(model: VoiceModel): string {
  return `${SHARED_VOICE_DIRECTORY}/${model.folderName}`;
}
