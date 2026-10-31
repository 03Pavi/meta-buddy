import type { LlamaContext } from 'llama.rn';
import type { AIProvider, GenerateRequest, GenerateResult } from '../types';
import { LOCAL_CONTEXT_TOKENS, LOCAL_REPLY_TOKENS } from './promptBudget';

/** Stop sequences for the chat formats of the catalog models (Gemma, Qwen, Llama), plus the generic ones. */
export const GEMMA_STOP_WORDS = ['<end_of_turn>', '<eos>', '</s>', '<|im_end|>', '<|endoftext|>', '<|eot_id|>'];

export const GEMMA_MODEL_LABEL = 'Gemma 3 1B (Q8_0), on device';

export class ModelLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelLoadError';
  }
}

export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationError';
  }
}

/**
 * On-device Gemma through llama.cpp (llama.rn). Loads the GGUF file from the given path, generates with
 * the model's own chat template, and runs fully on the phone. No network calls are made.
 */
export class GemmaProvider implements AIProvider {
  readonly id = 'gemma-on-device' as const;
  readonly label: string;
  readonly onDevice = true;

  private context: LlamaContext | null = null;
  private loading: Promise<void> | null = null;
  private loadedPath: string | null = null;

  constructor(
    private readonly modelPath: string,
    label: string = GEMMA_MODEL_LABEL,
  ) {
    this.label = label;
  }

  async prepare(onProgress?: (fraction: number) => void): Promise<void> {
    if (this.context && this.loadedPath === this.modelPath) return;
    if (!this.loading) {
      this.loading = this.load(onProgress).finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }

  private async load(onProgress?: (fraction: number) => void): Promise<void> {
    await this.release();
    // Loaded here, not at import time: llama.rn needs the Android native module.
    const { initLlama } = require('llama.rn') as typeof import('llama.rn');
    try {
      this.context = await initLlama(
        {
          model: this.modelPath,
          n_ctx: LOCAL_CONTEXT_TOKENS,
          // The CPU runtime is used by default. GPU offload is an opt-in change after device testing.
          n_gpu_layers: 0,
          use_mlock: false,
        },
        (progress: number) => onProgress?.(progress / 100),
      );
      this.loadedPath = this.modelPath;
    } catch (error) {
      this.context = null;
      const reason = error instanceof Error ? error.message : 'unknown error';
      throw new ModelLoadError(`The on-device model could not be loaded (${reason}).`);
    }
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    await this.prepare();
    const context = this.context;
    if (!context) throw new ModelLoadError('The on-device model is not loaded.');

    const onAbort = () => {
      // stopCompletion can return nothing when no completion is running, so it is not chained directly.
      Promise.resolve()
        .then(() => context.stopCompletion())
        .catch(() => undefined);
    };
    request.signal?.addEventListener('abort', onAbort);

    try {
      let streamed = '';
      const result = await context.completion(
        {
          messages: request.messages,
          n_predict: Math.min(request.maxTokens, LOCAL_REPLY_TOKENS),
          temperature: 0.7,
          top_p: 0.95,
          stop: GEMMA_STOP_WORDS,
        },
        (data) => {
          streamed += data.token;
          request.onPartial?.(streamed);
        },
      );

      if (request.signal?.aborted) {
        throw new GenerationError('Cancelled');
      }
      const text = result.text.trim();
      if (!text) {
        throw new GenerationError('The model returned an empty reply. Try rephrasing the question.');
      }
      return { text, model: this.label };
    } catch (error) {
      if (error instanceof GenerationError) throw error;
      throw new GenerationError('The on-device model stopped unexpectedly. Try again.');
    } finally {
      request.signal?.removeEventListener('abort', onAbort);
    }
  }

  async cancel(): Promise<void> {
    await this.context?.stopCompletion();
  }

  async release(): Promise<void> {
    const context = this.context;
    this.context = null;
    this.loadedPath = null;
    if (context) {
      await context.release();
    }
  }
}
