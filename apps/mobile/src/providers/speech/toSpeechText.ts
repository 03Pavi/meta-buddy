/** Longest reply read aloud. Longer answers stay in the transcript, so hands-free listening stays practical. */
export const MAX_SPOKEN_CHARS = 360;

/**
 * Turns a chat reply into text suitable for speech. Markdown symbols are removed, and the reply is cut at
 * a sentence boundary when it is too long.
 */
export function toSpeechText(reply: string, maxChars = MAX_SPOKEN_CHARS): string {
  const plain = reply
    // Code is never read aloud. It is shown on the screen, so the voice only points to it.
    .replace(/```[\s\S]*?(?:```|$)/g, ' Code is shown on the screen. ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  if (plain.length <= maxChars) return plain;

  // Keep whole sentences where possible.
  const window = plain.slice(0, maxChars);
  const lastStop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
  if (lastStop > maxChars / 2) {
    return window.slice(0, lastStop + 1).trim();
  }
  // Otherwise cut at the last space so no word is split.
  const lastSpace = window.lastIndexOf(' ');
  return `${window.slice(0, lastSpace > 0 ? lastSpace : maxChars).trim()}.`;
}
