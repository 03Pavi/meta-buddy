import { DEFAULT_MODEL_ID, LOCAL_MODELS, findModel, formatModelSize } from '../src/services/models/catalog';
import { GEMMA_MODEL_FILE_NAME } from '../src/services/models/modelFile';
import { DEFAULT_SETTINGS, parseSettings } from '../src/services/settings/settingsStore';

// settingsStore loads AsyncStorage, which needs a native module. Tests use an in-memory stand-in instead.
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

describe('model catalog', () => {
  it('has unique ids and file names', () => {
    expect(new Set(LOCAL_MODELS.map(m => m.id)).size).toBe(LOCAL_MODELS.length);
    expect(new Set(LOCAL_MODELS.map(m => m.fileName)).size).toBe(LOCAL_MODELS.length);
  });

  it('only lists GGUF files on public Hugging Face links', () => {
    for (const model of LOCAL_MODELS) {
      expect(model.fileName.endsWith('.gguf')).toBe(true);
      expect(model.url.startsWith('https://huggingface.co/')).toBe(true);
      expect(model.url.endsWith(model.fileName)).toBe(true);
      expect(model.sizeBytes).toBeGreaterThan(0);
    }
  });

  it('keeps the default Gemma file name, so an earlier download still works', () => {
    expect(findModel(DEFAULT_MODEL_ID).fileName).toBe(GEMMA_MODEL_FILE_NAME);
    expect(GEMMA_MODEL_FILE_NAME).toBe('gemma-3-1b-it-Q8_0.gguf');
  });

  it('falls back to the default model for an unknown id', () => {
    expect(findModel('removed-model').id).toBe(DEFAULT_MODEL_ID);
  });

  it('formats sizes in MB or GB', () => {
    expect(formatModelSize(675710816)).toBe('676 MB');
    expect(formatModelSize(1069306368)).toBe('1.1 GB');
  });
});

describe('settings modelId', () => {
  it('defaults to the Gemma model', () => {
    expect(DEFAULT_SETTINGS.modelId).toBe(DEFAULT_MODEL_ID);
  });

  it('keeps a known model id and replaces an unknown one', () => {
    expect(parseSettings({ modelId: 'qwen2.5-0.5b' }).modelId).toBe('qwen2.5-0.5b');
    expect(parseSettings({ modelId: 'not-a-model' }).modelId).toBe(DEFAULT_MODEL_ID);
  });
});
