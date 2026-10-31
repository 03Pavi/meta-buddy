import { Platform } from 'react-native';
import type RNFSApi from 'react-native-fs';
import { DEFAULT_MODEL_ID, findModel, LOCAL_MODELS, type LocalModel } from './catalog';
import { resumableDownload, savedBytes, type ResumableDownload } from '../download/resumableDownload';
import { hasModelStorageAccess, requestModelStorageAccess, SHARED_MODELS_DIRECTORY } from './storage';

// Loaded on first use. On the web there is no file system, so the native module is never touched there.
function RNFS(): typeof RNFSApi {
  if (Platform.OS !== 'android') throw new Error('The on-device model needs the Android app.');
  return require('react-native-fs') as typeof RNFSApi;
}

/** File name of the default model. Kept for the existing README and tests. */
export const GEMMA_MODEL_FILE_NAME = findModel(DEFAULT_MODEL_ID).fileName;

/** Where a model lives when the setting is blank: the shared Download/Buddy/models folder. */
export function defaultModelPath(model: LocalModel = findModel(DEFAULT_MODEL_ID)): string {
  if (Platform.OS !== 'android') return '';
  return `${SHARED_MODELS_DIRECTORY}/${model.fileName}`;
}

/** True when Buddy can write to the shared models folder. Creates the folder and a test file to check. */
export function modelStorageReady(): Promise<boolean> {
  return hasModelStorageAccess(
    async path => {
      await RNFS().mkdir(SHARED_MODELS_DIRECTORY);
      await RNFS().writeFile(path, 'ok', 'utf8');
      // Reading the file back proves the app can read the folder, not only write to it.
      if ((await RNFS().readFile(path, 'utf8')) !== 'ok') throw new Error('The folder cannot be read back.');
      // A model saved earlier belongs to another app ID. Reading it proves the app can read files it did not write.
      // Same steps as checkModelFile: look up the size, then read the start of each model file that is there.
      for (const model of LOCAL_MODELS) {
        const modelPath = defaultModelPath(model);
        if (await RNFS().exists(modelPath)) {
          await RNFS().stat(modelPath);
          await RNFS().read(modelPath, 4, 0, 'ascii');
        }
      }
    },
    path => RNFS().unlink(path),
  );
}

/**
 * Models downloaded by an earlier build live in the app's private folder. Move each finished one (exact size match)
 * into the shared folder so it is found. Partial files are left where they are.
 */
export async function moveLegacyModels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  for (const model of LOCAL_MODELS) {
    const legacy = `${RNFS().ExternalDirectoryPath}/models/${model.fileName}`;
    const target = defaultModelPath(model);
    const partial = `${target}.part`;
    try {
      if (!(await RNFS().exists(legacy))) continue;
      const legacyStat = await RNFS().stat(legacy);
      if (Number(legacyStat.size) !== model.sizeBytes) continue;
      if (await RNFS().exists(target)) {
        const targetStat = await RNFS().stat(target);
        if (Number(targetStat.size) === model.sizeBytes) {
          await RNFS().unlink(legacy).catch(() => undefined);
          continue;
        }
      }
      // Copy to a temporary name first, so a copy that is cut off never replaces a good file.
      await RNFS().unlink(partial).catch(() => undefined);
      await RNFS().copyFile(legacy, partial);
      if (Number((await RNFS().stat(partial)).size) !== model.sizeBytes) {
        await RNFS().unlink(partial).catch(() => undefined);
        continue;
      }
      await RNFS().unlink(target).catch(() => undefined);
      await RNFS().moveFile(partial, target);
      await RNFS().unlink(legacy).catch(() => undefined);
    } catch {
      // Leave the file where it is. The Models screen still reports it as not downloaded.
    }
  }
}

/** Asks for storage access. On Android 11+ the user switches on All files access and comes back to check again. */
export function requestModelStorage(): Promise<boolean> {
  return requestModelStorageAccess(modelStorageReady);
}

/** Empty setting means "use the default location". A value starting with file:// is accepted and normalised. */
export function resolveModelPath(configured: string, model: LocalModel = findModel(DEFAULT_MODEL_ID)): string {
  const trimmed = configured.trim();
  if (!trimmed) return defaultModelPath(model);
  return trimmed.startsWith('file://') ? trimmed.slice('file://'.length) : trimmed;
}

/** GGUF files start with the ASCII bytes "GGUF". Checking this catches wrong or truncated downloads early. */
export function hasGgufHeader(firstBytes: string): boolean {
  return firstBytes === 'GGUF';
}

export interface ModelFileStatus {
  path: string;
  exists: boolean;
  sizeBytes?: number;
  valid: boolean;
  problem?: string;
}

export async function checkModelFile(
  configured: string,
  model: LocalModel = findModel(DEFAULT_MODEL_ID),
): Promise<ModelFileStatus> {
  if (Platform.OS !== 'android') {
    return { path: '', exists: false, valid: false, problem: 'The on-device model is only available in the Android app.' };
  }
  const path = resolveModelPath(configured, model);
  try {
    if (!(await RNFS().exists(path))) {
      return {
        path,
        exists: false,
        valid: false,
        problem: 'No model file at this location. Download it or copy the GGUF file there (see README).',
      };
    }
    const stat = await RNFS().stat(path);
    const size = Number(stat.size);
    const header = await RNFS().read(path, 4, 0, 'ascii');
    if (!hasGgufHeader(header)) {
      return { path, exists: true, sizeBytes: size, valid: false, problem: 'This file is not a GGUF model.' };
    }
    return { path, exists: true, sizeBytes: size, valid: true };
  } catch {
    return {
      path,
      exists: false,
      valid: false,
      problem: 'Buddy cannot read this file. Allow storage access in Settings → Permissions, then tap Check again.',
    };
  }
}

export interface ModelDownload {
  /** Resolves when the file is complete and verified. Rejects on failure or cancel. */
  done: Promise<void>;
  cancel: () => void;
}

/**
 * Downloads a model into the default location. Writes to a .part file first, so a cancelled or failed download
 * never leaves something that looks like a model. The file is moved into place only after the GGUF check passes.
 */
/**
 * Downloads a model into the default location in pieces, and keeps what was saved if it stops. Starting again
 * continues from the saved part. The file is moved into place only after the GGUF check passes.
 */
export function downloadModel(model: LocalModel, onProgress: (fraction: number) => void): ModelDownload {
  const target = defaultModelPath(model);
  const partial = `${target}.part`;
  let cancelled = false;
  let inner: ResumableDownload | null = null;

  const done = (async () => {
    if (!(await modelStorageReady())) {
      throw new Error('Allow storage access for Buddy first, then try the download again.');
    }
    if (cancelled) throw new Error('Download cancelled');
    await RNFS().mkdir(SHARED_MODELS_DIRECTORY);

    // The model is already complete: drop any leftover partial copy and do not download it again.
    if ((await modelOnPhone(model)) === 'yes') {
      await RNFS().unlink(partial).catch(() => undefined);
      return;
    }

    inner = resumableDownload({ url: model.url, partialPath: partial, expectedBytes: model.sizeBytes, onProgress });
    await inner.done;

    const header = await RNFS().read(partial, 4, 0, 'ascii');
    if (!hasGgufHeader(header)) {
      await RNFS().unlink(partial).catch(() => undefined);
      throw new Error('The downloaded file is not a valid model. Try again.');
    }
    await RNFS().unlink(target).catch(() => undefined);
    await RNFS().moveFile(partial, target);
  })();

  return {
    done,
    cancel: () => {
      cancelled = true;
      inner?.cancel();
    },
  };
}

/**
 * Whether a model is on the phone, judged by its file size. Size alone is enough here, so a file that cannot be
 * read still counts as present. 'needs-access' means the app cannot see the file at all, so storage access is needed.
 */
export async function modelOnPhone(model: LocalModel): Promise<'yes' | 'no' | 'needs-access'> {
  if (Platform.OS !== 'android') return 'no';
  const path = defaultModelPath(model);
  try {
    if (!(await RNFS().exists(path))) return 'no';
    return Number((await RNFS().stat(path)).size) === model.sizeBytes ? 'yes' : 'no';
  } catch {
    return 'needs-access';
  }
}

/** Creates the shared models folder, so it exists before the first download or model check. */
export async function ensureModelFolder(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await RNFS().mkdir(SHARED_MODELS_DIRECTORY).catch(() => undefined);
}

/** Places a model file is commonly found, in the order Buddy suggests them. The first one is the default. */
export function suggestedModelLocations(model: LocalModel): string[] {
  if (Platform.OS !== 'android') return [];
  return [
    defaultModelPath(model),
    `${RNFS().ExternalDirectoryPath}/models/${model.fileName}`,
    `/storage/emulated/0/Documents/Buddy/models/${model.fileName}`,
  ];
}

/** Whether the model file is at a given path: 'yes', 'no', or 'needs-access' when Buddy cannot see the path. */
export async function modelAtPath(path: string, model: LocalModel): Promise<'yes' | 'no' | 'needs-access'> {
  try {
    if (!(await RNFS().exists(path))) return 'no';
    return Number((await RNFS().stat(path)).size) === model.sizeBytes ? 'yes' : 'no';
  } catch {
    return 'needs-access';
  }
}

/** Share of a model already saved in its partial file, from 0 to 1. Used to offer Resume. */
export async function partialModelProgress(model: LocalModel): Promise<number> {
  if (Platform.OS !== 'android') return 0;
  const partial = `${defaultModelPath(model)}.part`;
  return (await savedBytes(partial)) / model.sizeBytes;
}
