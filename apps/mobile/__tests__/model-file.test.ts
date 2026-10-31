import { Platform } from 'react-native';
import { GEMMA_MODEL_FILE_NAME, hasGgufHeader, resolveModelPath } from '../src/services/models/modelFile';

jest.mock('react-native-fs', () => ({
  ExternalDirectoryPath: '/storage/emulated/0/Android/data/com.buddy/files',
  exists: jest.fn(),
  stat: jest.fn(),
  read: jest.fn(),
}));

describe('resolveModelPath', () => {
  beforeAll(() => {
    // The default location only exists in the Android app, so the test runs as Android.
    (Platform as { OS: string }).OS = 'android';
  });

  it("uses the app's own models folder when the setting is blank", () => {
    expect(resolveModelPath('  ')).toBe(
      `/storage/emulated/0/Android/data/com.buddy/files/models/${GEMMA_MODEL_FILE_NAME}`,
    );
  });

  it('strips a file:// prefix from a configured path', () => {
    expect(resolveModelPath('file:///sdcard/models/m.gguf')).toBe('/sdcard/models/m.gguf');
  });

  it('keeps a plain configured path as it is', () => {
    expect(resolveModelPath('/data/x.gguf')).toBe('/data/x.gguf');
  });
});

describe('hasGgufHeader', () => {
  it('accepts the GGUF magic and rejects anything else', () => {
    expect(hasGgufHeader('GGUF')).toBe(true);
    expect(hasGgufHeader('<htm')).toBe(false);
    expect(hasGgufHeader('')).toBe(false);
  });
});
