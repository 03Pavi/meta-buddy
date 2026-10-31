import {
  assistantReducer,
  initialAssistantState,
  isBusy,
  type AssistantState,
  type TranscriptMessage,
} from '../src/features/assistant/assistantState';
import { needsVisualContext } from '../src/features/assistant/intent';

const reply: TranscriptMessage = {
  id: 'a1',
  role: 'assistant',
  text: 'A laptop.',
  createdAt: 1,
};

describe('assistantReducer', () => {
  it('moves through a text turn: started, then finished into speaking', () => {
    let state: AssistantState = assistantReducer(initialAssistantState, {
      type: 'requestStarted',
      requestId: 'req-1',
      withImage: false,
    });
    expect(state.phase).toBe('processing');
    expect(isBusy(state.phase)).toBe(true);

    state = assistantReducer(state, {
      type: 'requestFinished',
      requestId: 'req-1',
      conversationId: 'conv-1',
      contextReset: false,
      reply,
    });
    expect(state.phase).toBe('speaking');
    expect(state.conversationId).toBe('conv-1');
    expect(state.messages).toEqual([reply]);
    expect(state.pendingRequestId).toBeUndefined();
  });

  it('uses the capturing phase for visual turns', () => {
    const state = assistantReducer(initialAssistantState, {
      type: 'requestStarted',
      requestId: 'r',
      withImage: true,
    });
    expect(state.phase).toBe('capturing');
  });

  it('ignores replies for a request that is no longer pending (stale or cancelled)', () => {
    const started = assistantReducer(initialAssistantState, {
      type: 'requestStarted',
      requestId: 'new',
      withImage: false,
    });
    const stale = assistantReducer(started, {
      type: 'requestFinished',
      requestId: 'old',
      conversationId: 'c',
      contextReset: false,
      reply,
    });
    expect(stale).toBe(started);
    expect(stale.messages).toEqual([]);
  });

  it('records failures on the pending request and clears them on demand', () => {
    let state = assistantReducer(initialAssistantState, {
      type: 'requestStarted',
      requestId: 'r',
      withImage: false,
    });
    state = assistantReducer(state, {
      type: 'requestFailed',
      requestId: 'r',
      message: 'Backend offline',
    });
    expect(state.phase).toBe('error');
    expect(state.lastError).toBe('Backend offline');

    state = assistantReducer(state, { type: 'errorCleared' });
    expect(state.lastError).toBeUndefined();
    expect(state.phase).toBe('idle');
  });

  it('reports non-request failures such as speech input errors', () => {
    const state = assistantReducer(initialAssistantState, {
      type: 'failed',
      message: 'Microphone permission is needed',
    });
    expect(state.phase).toBe('error');
    expect(state.lastError).toBe('Microphone permission is needed');
  });

  it('clears the transcript and context when the conversation is cleared', () => {
    const withHistory: AssistantState = {
      ...initialAssistantState,
      messages: [reply],
      conversationId: 'conv-1',
      contextReset: true,
    };
    const cleared = assistantReducer(withHistory, {
      type: 'conversationCleared',
    });
    expect(cleared.messages).toEqual([]);
    expect(cleared.conversationId).toBeUndefined();
    expect(cleared.contextReset).toBe(false);
  });
});

describe('needsVisualContext', () => {
  it.each([
    'What am I looking at?',
    "What's this?",
    'Can you read this label for me',
    'what is in front of me',
    'What brand is it?',
  ])('treats "%s" as a visual question', message => {
    expect(needsVisualContext(message)).toBe(true);
  });

  it.each([
    'Explain what a microservice is',
    'What is the capital of France?',
    'Set a reminder for 5pm',
  ])('keeps "%s" text-only', message => {
    expect(needsVisualContext(message)).toBe(false);
  });
});
