import {
  DEFAULT_SETTINGS,
  parseSettings,
} from '../src/services/settings/settingsStore';
import { parseTranscript } from '../src/services/storage/transcriptStore';

// The parsers under test do not touch storage, so an inline in-memory stub is enough.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  const asyncStorage = {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
  };
  return { __esModule: true, default: asyncStorage, ...asyncStorage };
});

describe('parseSettings', () => {
  it('returns defaults for missing or non-object input', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('corrupt')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and replaces invalid ones with defaults', () => {
    const parsed = parseSettings({
      speechInput: 'phone',
      spokenReplies: 'yes',
      cameraFrameRate: 30,
      cameraQuality: 'HIGH',
    });
    expect(parsed.speechInput).toBe('phone');
    expect(parsed.spokenReplies).toBe(DEFAULT_SETTINGS.spokenReplies);
    expect(parsed.cameraFrameRate).toBe(DEFAULT_SETTINGS.cameraFrameRate);
    expect(parsed.cameraQuality).toBe('HIGH');
  });

  it('never adopts a speech source outside the allowed set', () => {
    expect(parseSettings({ speechInput: 'always-on' }).speechInput).toBe(
      DEFAULT_SETTINGS.speechInput,
    );
  });
});

describe('parseTranscript', () => {
  it('drops malformed entries and keeps well-formed messages', () => {
    const valid = { id: '1', role: 'user', text: 'hi', createdAt: 1 };
    const result = parseTranscript([
      valid,
      { id: 2 },
      { id: '3', role: 'robot', text: 'x', createdAt: 1 },
      null,
    ]);
    expect(result).toEqual([valid]);
  });

  it('returns an empty list for non-array input', () => {
    expect(parseTranscript({})).toEqual([]);
  });
});
