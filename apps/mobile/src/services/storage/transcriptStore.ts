import AsyncStorage from '@react-native-async-storage/async-storage';
import { MAX_STORED_MESSAGES } from '../../config/constants';
import type { TranscriptMessage } from '../../features/assistant/assistantState';

const STORAGE_KEY = 'pavi.transcript.v1';

/** Keeps only well-formed messages. Stored text is kept on this device only. Images are never stored. */
export function parseTranscript(raw: unknown): TranscriptMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is TranscriptMessage =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as TranscriptMessage).id === 'string' &&
        typeof (item as TranscriptMessage).text === 'string' &&
        ['user', 'assistant', 'system'].includes(
          (item as TranscriptMessage).role,
        ) &&
        typeof (item as TranscriptMessage).createdAt === 'number',
    )
    .slice(-MAX_STORED_MESSAGES);
}

export async function loadTranscript(): Promise<TranscriptMessage[]> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return parseTranscript(stored ? JSON.parse(stored) : []);
  } catch {
    return [];
  }
}

export async function saveTranscript(
  messages: TranscriptMessage[],
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)),
    );
  } catch {
    // History is a convenience. A storage failure must not interrupt the conversation.
  }
}

export async function clearStoredTranscript(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: the in-memory transcript is already cleared.
  }
}
