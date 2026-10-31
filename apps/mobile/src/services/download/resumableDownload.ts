import type RNFSApi from 'react-native-fs';

/** Size of one piece of a download. Each piece is saved on its own, so a break only loses the piece in progress. */
export const CHUNK_BYTES = 8 * 1024 * 1024;
/** Tries per piece before the download stops and waits for the user to press Retry. */
const ATTEMPTS = 3;

export interface ResumableDownload {
  /** Resolves when the whole file is saved. Rejects if it stops, with a message that says to press Retry. */
  done: Promise<void>;
  cancel: () => void;
}

// Loaded on first use, so the native file module is never touched on the web.
function RNFS(): typeof RNFSApi {
  return require('react-native-fs') as typeof RNFSApi;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function sizeOf(path: string): Promise<number> {
  if (!(await RNFS().exists(path))) return 0;
  return Number((await RNFS().stat(path)).size);
}

/** Bytes already saved in the partial file. That is the resume point, so no separate state file is needed. */
export async function savedBytes(partialPath: string): Promise<number> {
  return sizeOf(partialPath).catch(() => 0);
}

/**
 * Downloads a file in pieces. Each piece is requested with an HTTP range and appended to the partial file. If the
 * download stops, the partial file keeps what was saved, and starting again continues from that point.
 */
export function resumableDownload(options: {
  url: string;
  partialPath: string;
  expectedBytes: number;
  onProgress: (fraction: number) => void;
}): ResumableDownload {
  const { url, partialPath, expectedBytes, onProgress } = options;
  const piecePath = `${partialPath}.piece`;
  let cancelled = false;
  let jobId: number | undefined;

  const fetchPiece = async (start: number, end: number): Promise<void> => {
    let reason = 'the connection dropped';
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      if (cancelled) throw new Error('Download cancelled');
      try {
        await RNFS().unlink(piecePath).catch(() => undefined);
        const job = RNFS().downloadFile({
          fromUrl: url,
          toFile: piecePath,
          background: true,
          headers: { Range: `bytes=${start}-${end}` },
          begin: result => {
            jobId = result.jobId;
          },
        });
        jobId = job.jobId;
        const result = await job.promise;
        if (cancelled) throw new Error('Download cancelled');
        if (result.statusCode !== 206) throw new Error(`HTTP ${result.statusCode}`);
        if ((await sizeOf(piecePath)) !== end - start + 1) throw new Error('the piece was cut short');
        return;
      } catch (error) {
        if (cancelled) throw new Error('Download cancelled');
        reason = error instanceof Error ? error.message : String(error);
        await delay(1500 * attempt);
      }
    }
    throw new Error(`Download stopped (${reason}). Tap Retry to continue where it left off.`);
  };

  const done = (async () => {
    // A partial file larger than the whole file cannot be right, so it is started again.
    if ((await sizeOf(partialPath)) > expectedBytes) await RNFS().unlink(partialPath).catch(() => undefined);

    let offset = await savedBytes(partialPath);
    onProgress(offset / expectedBytes);
    while (offset < expectedBytes) {
      const end = Math.min(offset + CHUNK_BYTES, expectedBytes) - 1;
      await fetchPiece(offset, end);
      const data = await RNFS().readFile(piecePath, 'base64');
      await RNFS().appendFile(partialPath, data, 'base64');
      await RNFS().unlink(piecePath).catch(() => undefined);
      offset = await savedBytes(partialPath);
      onProgress(offset / expectedBytes);
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
