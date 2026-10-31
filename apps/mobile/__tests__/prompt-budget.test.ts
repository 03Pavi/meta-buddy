import {
  buildLocalMessages,
  estimateTokens,
  PIP_SYSTEM_PROMPT,
} from '../src/providers/ai/promptBudget';

describe('PIP_SYSTEM_PROMPT', () => {
  it('is the Pip prompt from the specification', () => {
    expect(PIP_SYSTEM_PROMPT).toContain('You are Pip, a friendly and helpful personal AI assistant.');
    expect(PIP_SYSTEM_PROMPT).toContain("Answer the user's actual question directly.");
    expect(PIP_SYSTEM_PROMPT).toContain('If you do not know something, say so.');
  });
});

describe('buildLocalMessages', () => {
  it('puts the system prompt first and the new user message last', () => {
    const messages = buildLocalMessages([], 'Hello');
    expect(messages).toEqual([
      { role: 'system', content: PIP_SYSTEM_PROMPT },
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('keeps the most recent history when the budget is tight', () => {
    const long = 'x'.repeat(900);
    const history = [
      { role: 'user' as const, content: `old ${long}` },
      { role: 'assistant' as const, content: `older reply ${long}` },
      { role: 'user' as const, content: 'recent question' },
      { role: 'assistant' as const, content: 'recent answer' },
    ];
    const messages = buildLocalMessages(history, 'now', 400);
    const contents = messages.map((m) => m.content);
    expect(contents).toContain('recent answer');
    expect(contents).toContain('recent question');
    expect(contents.some((c) => c.startsWith('old'))).toBe(false);
  });

  it('never starts the history on an assistant turn (chat template needs user first)', () => {
    const history = [
      { role: 'assistant' as const, content: 'stray reply' },
      { role: 'user' as const, content: 'question' },
      { role: 'assistant' as const, content: 'answer' },
    ];
    const messages = buildLocalMessages(history, 'next');
    expect(messages[1].role).toBe('user');
  });

  it('drops stored system messages so they cannot override Pip', () => {
    const messages = buildLocalMessages(
      [{ role: 'system', content: 'Earlier context was not found' }],
      'hi',
    );
    expect(messages.filter((m) => m.role === 'system')).toHaveLength(1);
  });

  it('estimates tokens conservatively', () => {
    expect(estimateTokens('abcdefghi')).toBeGreaterThanOrEqual(3);
  });
});
