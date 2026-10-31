/** A GGUF model the app can download and run on the phone. Pure data, so tests can use it without native code. */
export interface LocalModel {
  id: string;
  /** Name shown in the app. */
  label: string;
  /** File name on the phone. Gemma keeps its original name, so a model copied earlier still works. */
  fileName: string;
  /** Public file on Hugging Face. No login is needed. */
  url: string;
  /** Exact size in bytes from the server, shown before download so the user can plan Wi-Fi and storage. */
  sizeBytes: number;
  /** Short note on what the model is good for. */
  note: string;
  /** Licence the model is published under. The user agrees to it by downloading. */
  license: string;
}

export const LOCAL_MODELS: readonly LocalModel[] = [
  {
    id: 'gemma-3-1b',
    label: 'Gemma 3 1B (Q8_0)',
    fileName: 'gemma-3-1b-it-Q8_0.gguf',
    url: 'https://huggingface.co/lmstudio-community/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q8_0.gguf',
    sizeBytes: 1069306368,
    note: 'Default. Balanced quality and speed.',
    license: 'Gemma Terms of Use',
  },
  {
    id: 'qwen2.5-0.5b',
    label: 'Qwen 2.5 0.5B (Q8_0)',
    fileName: 'qwen2.5-0.5b-instruct-q8_0.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q8_0.gguf',
    sizeBytes: 675710816,
    note: 'Smallest and fastest. Simpler answers, and the least memory.',
    license: 'Apache-2.0',
  },
  {
    id: 'llama-3.2-1b',
    label: 'Llama 3.2 1B (Q8_0)',
    fileName: 'Llama-3.2-1B-Instruct-Q8_0.gguf',
    url: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q8_0.gguf',
    sizeBytes: 1321083008,
    note: 'Similar size to Gemma 3 1B. A good second opinion for comparing answers.',
    license: 'Llama 3.2 Community License',
  },
  {
    id: 'qwen2.5-1.5b',
    label: 'Qwen 2.5 1.5B (Q4_K_M)',
    fileName: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    sizeBytes: 1117320736,
    note: 'Largest here, with the best answers. Q4 is smaller than Q8 but a little less precise. Needs more free RAM.',
    license: 'Apache-2.0',
  },
];

export const DEFAULT_MODEL_ID = 'gemma-3-1b';

/** Returns the model for an id, or the default when the id is unknown (for example, a removed model). */
export function findModel(id: string): LocalModel {
  return LOCAL_MODELS.find(model => model.id === id) ?? LOCAL_MODELS[0];
}

/** Human-readable size for the model list, such as "1.0 GB" or "650 MB". */
export function formatModelSize(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}
