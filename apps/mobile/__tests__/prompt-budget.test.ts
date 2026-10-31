import {
  buildLocalMessages,
  buildSummaryMessages,
  estimateTokens,
  BUDDY_SYSTEM_PROMPT,
} from '../src/providers/ai/promptBudget';

describe('BUDDY_SYSTEM_PROMPT', () => {
  it('names the assistant Buddy and credits Pavitar as the creator', () => {
    expect(BUDDY_SYSTEM_PROMPT).toContain('You are Buddy, a friendly and helpful personal AI assistant.');
    expect(BUDDY_SYSTEM_PROMPT).toContain("Answer the user's actual question directly.");
    expect(BUDDY_SYSTEM_PROMPT).toContain('created by Pavitar');
  });
});

describe('buildLocalMessages', () => {
  it('puts the system prompt first and the new user message last', () => {
    const messages = buildLocalMessages([], 'Hello');
    expect(messages).toEqual([
      { role: 'system', content: BUDDY_SYSTEM_PROMPT },
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

  it('adds the rolling summary to the system prompt', () => {
    const messages = buildLocalMessages([], 'What did I ask first?', undefined, undefined, 'The user asked about trains.');
    expect(messages[0].content).toContain(BUDDY_SYSTEM_PROMPT);
    expect(messages[0].content).toContain('Earlier in this conversation: The user asked about trains.');
  });

  it('leaves the system prompt unchanged when there is no summary', () => {
    const messages = buildLocalMessages([], 'Hello');
    expect(messages[0].content).toBe(BUDDY_SYSTEM_PROMPT);
  });

  it('estimates tokens conservatively', () => {
    expect(estimateTokens('abcdefghi')).toBeGreaterThanOrEqual(3);
  });
});

describe('buildSummaryMessages', () => {
  it('asks for a summary of the older turns, including the earlier summary', () => {
    const messages = buildSummaryMessages('Talked about trains.', [
      { role: 'user', content: 'Which platform?' },
      { role: 'assistant', content: 'Platform 4.' },
    ]);
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toContain('Summary so far: Talked about trains.');
    expect(messages[1].content).toContain('User: Which platform?');
    expect(messages[1].content).toContain('Buddy: Platform 4.');
  });
});
