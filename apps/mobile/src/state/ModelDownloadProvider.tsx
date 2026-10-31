import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { LocalModel } from '../services/models/catalog';
import { downloadModel, type ModelDownload } from '../services/models/modelFile';
import type { VoiceModel } from '../services/speech/voiceModels';
import { downloadVoiceModel } from '../services/speech/voiceModelFile';

interface ActiveDownload {
  /** Chat model or speech model. Ids are unique across both catalogs. */
  kind: 'chat' | 'speech';
  modelId: string;
  progress: number;
}

interface ModelDownloadContextValue {
  /** The download running right now, or null. Only one download runs at a time. */
  active: ActiveDownload | null;
  /** Message from the last download that failed. Cleared when a new download starts. */
  error: string | null;
  /** Goes up by one each time a download ends, so screens can reload which models are on the phone. */
  finishedCount: number;
  start: (model: LocalModel) => void;
  startSpeech: (model: VoiceModel) => void;
  cancel: () => void;
}

const ModelDownloadContext = createContext<ModelDownloadContextValue | null>(null);

/**
 * Keeps a model download running across screens. The download lives here, not in a screen, so leaving the Models
 * screen does not lose its progress or allow a second copy to start.
 */
export function ModelDownloadProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<ActiveDownload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishedCount, setFinishedCount] = useState(0);
  const jobRef = useRef<ModelDownload | null>(null);

  const run = useCallback((kind: ActiveDownload['kind'], modelId: string, makeJob: (onProgress: (fraction: number) => void) => ModelDownload) => {
    if (jobRef.current) return;
    setError(null);
    setActive({ kind, modelId, progress: 0 });
    const job = makeJob(progress =>
      setActive(current => (current && current.modelId === modelId ? { ...current, progress } : current)),
    );
    jobRef.current = job;
    job.done
      .catch(caught => setError(caught instanceof Error ? caught.message : 'Download failed'))
      .finally(() => {
        jobRef.current = null;
        setActive(null);
        setFinishedCount(count => count + 1);
      });
  }, []);

  const start = useCallback(
    (model: LocalModel) => run('chat', model.id, onProgress => downloadModel(model, onProgress)),
    [run],
  );

  const startSpeech = useCallback(
    (model: VoiceModel) => run('speech', model.id, onProgress => downloadVoiceModel(model, onProgress)),
    [run],
  );

  const cancel = useCallback(() => {
    jobRef.current?.cancel();
  }, []);

  const value = useMemo(
    () => ({ active, error, finishedCount, start, startSpeech, cancel }),
    [active, error, finishedCount, start, startSpeech, cancel],
  );

  return <ModelDownloadContext.Provider value={value}>{children}</ModelDownloadContext.Provider>;
}

export function useModelDownloads(): ModelDownloadContextValue {
  const value = useContext(ModelDownloadContext);
  if (!value) throw new Error('useModelDownloads must be used inside ModelDownloadProvider');
  return value;
}
