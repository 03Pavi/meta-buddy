import { Platform } from 'react-native';
import type RNFSApi from 'react-native-fs';
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

/**
 * Downloads the speech model zip to a partial file, checks its exact size, unpacks it into the shared voice
 * folder and removes the zip. The partial file never replaces a finished model.
 */
export function downloadVoiceModel(model: VoiceModel, onProgress: (fraction: number) => void): ModelDownload {
  const zip = `${SHARED_VOICE_DIRECTORY}/${model.folderName}.zip`;
  const partial = `${zip}.part`;
  let jobId: number | undefined;
  let cancelled = false;

  const done = (async () => {
    if (!(await modelStorageReady())) {
      throw new Error('Allow storage access for Buddy first, then try the download again.');
    }
    await RNFS().mkdir(SHARED_VOICE_DIRECTORY);
    await RNFS().unlink(partial).catch(() => undefined);

    const download = RNFS().downloadFile({
      fromUrl: model.url,
      toFile: partial,
      background: true,
      progressDivider: 1,
      begin: result => {
        jobId = result.jobId;
      },
      progress: result => {
        if (result.contentLength > 0) onProgress(result.bytesWritten / result.contentLength);
      },
    });
    jobId = download.jobId;
    const result = await download.promise;
    if (cancelled) throw new Error('Download cancelled');
    if (result.statusCode !== 200) {
      await RNFS().unlink(partial).catch(() => undefined);
      throw new Error(`Download failed (HTTP ${result.statusCode}). Check your internet connection and try again.`);
    }
    if (Number((await RNFS().stat(partial)).size) !== model.sizeBytes) {
      await RNFS().unlink(partial).catch(() => undefined);
      throw new Error('The speech model download is incomplete. Try again.');
    }

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
      if (jobId !== undefined) RNFS().stopDownload(jobId);
    },
  };
}
