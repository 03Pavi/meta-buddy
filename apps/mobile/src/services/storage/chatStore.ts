import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TranscriptMessage } from '../../features/assistant/assistantState';
import { MAX_STORED_MESSAGES } from '../../config/constants';
import { clearStoredTranscript, loadTranscript, parseTranscript } from './transcriptStore';

const STORAGE_KEY = 'buddy.chats.v1';
const MAX_CHATS = 50;
const TITLE_LENGTH = 48;

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
}

interface ChatRecord extends ChatSummary {
  messages: TranscriptMessage[];
}

/** Title from the first question in the chat, so the list is easy to scan. */
export function chatTitle(messages: TranscriptMessage[]): string {
  const first = messages.find(message => message.role === 'user')?.text.trim() ?? '';
  if (!first) return 'New chat';
  return first.length > TITLE_LENGTH ? `${first.slice(0, TITLE_LENGTH - 1)}…` : first;
}

function isChatRecord(item: unknown): item is ChatRecord {
  if (typeof item !== 'object' || item === null) return false;
  const record = item as ChatRecord;
  return typeof record.id === 'string' && typeof record.title === 'string' && typeof record.updatedAt === 'number';
}

async function readAll(): Promise<ChatRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isChatRecord).map(record => ({
      ...record,
      messages: parseTranscript((record as ChatRecord & { messages?: unknown }).messages),
    }));
  } catch {
    return [];
  }
}

async function writeAll(records: ChatRecord[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_CHATS)));
  } catch {
    // Saved chats are a convenience. A storage failure must not interrupt the conversation.
  }
}

// Reads and writes run one after another, so two quick saves cannot overwrite each other.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

/** Moves a transcript saved by an earlier build into the chat list, once. */
async function importLegacyTranscript(records: ChatRecord[]): Promise<ChatRecord[]> {
  if (records.length > 0) return records;
  const legacy = await loadTranscript();
  if (legacy.length === 0) return records;
  const imported: ChatRecord = {
    id: `legacy-${Date.now().toString(36)}`,
    title: chatTitle(legacy),
    updatedAt: legacy[legacy.length - 1].createdAt,
    messages: legacy,
  };
  await writeAll([imported]);
  await clearStoredTranscript();
  return [imported];
}

/** Saved chats, most recent first. Only title and time, so the list stays light. */
export function listChats(): Promise<ChatSummary[]> {
  return serial(async () => {
    const records = await importLegacyTranscript(await readAll());
    return [...records]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
  });
}

export function loadChat(id: string): Promise<TranscriptMessage[]> {
  return serial(async () => {
    const record = (await readAll()).find(item => item.id === id);
    return record?.messages ?? [];
  });
}

/** Saves the current messages under this chat id. An empty chat is not kept. */
export function saveChat(id: string, messages: TranscriptMessage[]): Promise<void> {
  return serial(async () => {
    if (messages.length === 0) return;
    const records = await readAll();
    const kept = messages.slice(-MAX_STORED_MESSAGES);
    const next: ChatRecord = { id, title: chatTitle(kept), updatedAt: Date.now(), messages: kept };
    await writeAll([next, ...records.filter(item => item.id !== id)]);
  });
}

export function deleteChat(id: string): Promise<void> {
  return serial(async () => {
    await writeAll((await readAll()).filter(item => item.id !== id));
  });
}
