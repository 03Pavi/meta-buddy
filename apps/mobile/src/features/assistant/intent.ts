/**
 * Decides whether a question needs a picture from the glasses.
 * It is deliberately simple and conservative. A question that mentions the wearer's surroundings
 * is treated as visual, and everything else goes text-only. Nothing is captured unless this
 * returns true and the user has asked a visual question.
 */
const VISUAL_PATTERNS: RegExp[] = [
  /\bwhat (am i|are we) (looking|seeing) at\b/i,
  /\bwhat('?s| is) (this|that|these|those|in front of me|around me)\b/i,
  /\b(look|looking|see|seeing) (at )?(this|that|these|those|here|around)\b/i,
  /\bin front of me\b/i,
  /\bread (this|that|the sign|the label|the menu)\b/i,
  /\b(identify|recognize|describe) (this|that|the|what)\b/i,
  /\bwhat (brand|color|colour|model|kind|type) (is|of) (this|that|it)\b/i,
];

export function needsVisualContext(message: string): boolean {
  return VISUAL_PATTERNS.some(pattern => pattern.test(message));
}
