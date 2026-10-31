import type { ChatMessage } from '../types';

/** System prompt for Buddy, the assistant in this app. */
export const BUDDY_SYSTEM_PROMPT =
  "You are Buddy, a friendly and helpful personal AI assistant. Keep replies concise, natural, and warm. " +
  "Speak in clear, conversational language. Answer the user's actual question directly. " +
  'If you do not know something, say so. ' +
  'If asked who created or built you, say that you were created by Pavitar. Say nothing more about your creator, ' +
  'and do not explain how you were built or which technology you run on.';

/** Context window configured for the on-device model. The model reports 32k, but phones have limited memory. */
export const LOCAL_CONTEXT_TOKENS = 4096;
/** Tokens reserved for the reply. */
export const LOCAL_REPLY_TOKENS = 220;
/** Budget for history and the new message, after the system prompt and reply reservation. */
export const LOCAL_HISTORY_TOKENS = 2400;

/**
 * Rough token estimate. English text is about four characters per token. Three is used here so the
 * estimate errs on the high side, which keeps prompts inside the context window.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3) + 4;
}

/**
 * Builds the message list for one local turn. The system prompt is always kept. History is trimmed from
 * the oldest end until it fits the budget, and the new user message is always kept.
 */
export function buildLocalMessages(
  history: ChatMessage[],
  userText: string,
  budgetTokens = LOCAL_HISTORY_TOKENS,
  systemPrompt = BUDDY_SYSTEM_PROMPT,
): ChatMessage[] {
  const current: ChatMessage = { role: 'user', content: userText };
  let used = estimateTokens(userText);
  const kept: ChatMessage[] = [];

  // Walk backwards so the most recent turns survive. Skip anything that would overflow the budget.
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message.role === 'system') continue;
    const cost = estimateTokens(message.content);
    if (used + cost > budgetTokens) break;
    used += cost;
    kept.unshift(message);
  }

  // Gemma's chat template requires alternating user and assistant turns. Start the window on a user turn.
  while (kept.length > 0 && kept[0].role !== 'user') {
    kept.shift();
  }

  return [{ role: 'system', content: systemPrompt }, ...kept, current];
}
