import { Platform } from 'react-native';
import type RNFSApi from 'react-native-fs';
import { resumableDownload, savedBytes, type ResumableDownload } from '../download/resumableDownload';
import { modelStorageReady, type ModelDownload } from '../models/modelFile';
import { SHARED_VOICE_DIRECTORY, voiceModelPath, type VoiceModel } from './voiceModels';

// Loaded on first use, so the native file module is never touched on the web.
function RNFS(): typeof RNFSApi {
  return require('react-native-fs') as typeof RNFSApi;
}

// The zip module is native too. It loads only when a speech model is unpacked, not when the app starts.
function unzip(source: string, target: string): Promise<string> {
  return (require('react-native-zip-archive') as typeof import('react-native-zip-archive')).unzip(source, target);
}

/** True when the unpacked speech model is on the phone. Vosk always has this config file. */
export async function isVoiceModelReady(model: VoiceModel): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    return await RNFS().exists(`${voiceModelPath(model)}/conf/model.conf`);
  } catch {
    return false;
  }
}

/** Share of a speech model's zip already saved, from 0 to 1. Used to offer Resume. */
export async function partialVoiceModelProgress(model: VoiceModel): Promise<number> {
  if (Platform.OS !== 'android') return 0;
  return (await savedBytes(`${SHARED_VOICE_DIRECTORY}/${model.folderName}.zip.part`)) / model.sizeBytes;
}

/**
 * Downloads the speech model zip in pieces, keeping what was saved if it stops. The finished zip is unpacked into
 * the shared voice folder and removed.
 */
export function downloadVoiceModel(model: VoiceModel, onProgress: (fraction: number) => void): ModelDownload {
  const zip = `${SHARED_VOICE_DIRECTORY}/${model.folderName}.zip`;
  const partial = `${zip}.part`;
  let cancelled = false;
  let inner: ResumableDownload | null = null;

  const done = (async () => {
    if (!(await modelStorageReady())) {
      throw new Error('Allow storage access for Buddy first, then try the download again.');
    }
    if (cancelled) throw new Error('Download cancelled');
    await RNFS().mkdir(SHARED_VOICE_DIRECTORY);

    inner = resumableDownload({ url: model.url, partialPath: partial, expectedBytes: model.sizeBytes, onProgress });
    await inner.done;

    await RNFS().unlink(zip).catch(() => undefined);
    await RNFS().moveFile(partial, zip);
    await unzip(zip, SHARED_VOICE_DIRECTORY);
    await RNFS().unlink(zip).catch(() => undefined);
    if (!(await isVoiceModelReady(model))) {
      throw new Error('The speech model could not be unpacked. Try again.');
    }
  })();

  return {
    done,
    cancel: () => {
      cancelled = true;
      inner?.cancel();
    },
  };
}
