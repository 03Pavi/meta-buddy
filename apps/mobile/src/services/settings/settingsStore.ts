import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_MODEL_ID, LOCAL_MODELS } from '../models/catalog';

export type SpeechInputSource = 'glasses' | 'phone' | 'text';

export interface AppSettings {
  /** Which model from the catalog answers questions. */
  modelId: string;
  /** Empty means the default app-storage location for the selected model's file. */
  modelPath: string;
  speechInput: SpeechInputSource;
  /** Use the offline speech model from Models instead of the phone's own recognizer. */
  offlineSpeech: boolean;
  /** Hands-free loop: after each spoken reply, listen again. Turning it on is the user's consent to use the mic. */
  voiceMode: boolean;
  spokenReplies: boolean;
  keepHistory: boolean;
  voiceInvocations: boolean;
  cameraQuality: 'LOW' | 'MEDIUM' | 'HIGH';
  cameraFrameRate: 15 | 24;
}

export const DEFAULT_SETTINGS: AppSettings = {
  modelId: DEFAULT_MODEL_ID,
  modelPath: '',
  speechInput: 'phone',
  offlineSpeech: false,
  voiceMode: false,
  spokenReplies: true,
  keepHistory: false,
  voiceInvocations: false,
  cameraQuality: 'MEDIUM',
  cameraFrameRate: 15,
};

const STORAGE_KEY = 'pavi.settings.v1';

/**
 * Parses stored settings, keeping defaults for missing or invalid fields. Keys left over from older versions
 * (such as the removed backend address) are ignored. A corrupt value must never stop the app from starting.
 */
export function parseSettings(raw: unknown): AppSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS };
  const data = raw as Partial<Record<keyof AppSettings, unknown>>;
  const pick = <K extends keyof AppSettings>(
    key: K,
    valid: (value: unknown) => boolean,
  ): AppSettings[K] =>
    valid(data[key]) ? (data[key] as AppSettings[K]) : DEFAULT_SETTINGS[key];

  return {
    modelId: pick(
      'modelId',
      v => typeof v === 'string' && LOCAL_MODELS.some(model => model.id === v),
    ),
    modelPath: pick('modelPath', v => typeof v === 'string'),
    speechInput: pick(
      'speechInput',
      v => v === 'glasses' || v === 'phone' || v === 'text',
    ),
    offlineSpeech: pick('offlineSpeech', v => typeof v === 'boolean'),
    voiceMode: pick('voiceMode', v => typeof v === 'boolean'),
    spokenReplies: pick('spokenReplies', v => typeof v === 'boolean'),
    keepHistory: pick('keepHistory', v => typeof v === 'boolean'),
    voiceInvocations: pick('voiceInvocations', v => typeof v === 'boolean'),
    cameraQuality: pick(
      'cameraQuality',
      v => v === 'LOW' || v === 'MEDIUM' || v === 'HIGH',
    ),
    cameraFrameRate: pick('cameraFrameRate', v => v === 15 || v === 24),
  };
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return parseSettings(stored ? JSON.parse(stored) : null);
  } catch {
    // Storage can be unavailable (for example in a restricted profile). Fall back to defaults.
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Settings still apply for this session. They are simply not remembered after a restart.
  }
}
