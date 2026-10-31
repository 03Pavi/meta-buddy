import { MAX_SPOKEN_CHARS, toSpeechText } from '../src/providers/speech/toSpeechText';

describe('toSpeechText', () => {
  it('removes markdown so the voice does not read symbols aloud', () => {
    const spoken = toSpeechText('## Tip\n- **Drink** water `daily`\n- See [docs](https://example.test)');
    expect(spoken).toBe('Tip Drink water daily See docs');
  });

  it('returns short replies unchanged apart from whitespace', () => {
    expect(toSpeechText('  Hello   there.  ')).toBe('Hello there.');
  });

  it('cuts long replies at a sentence boundary within the limit', () => {
    const sentence = 'This is a sentence that adds some length to the reply. ';
    const reply = sentence.repeat(20);
    const spoken = toSpeechText(reply);
    expect(spoken.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS);
    expect(spoken.endsWith('.')).toBe(true);
  });

  it('cuts at a word boundary when there is no sentence break', () => {
    const words = 'word '.repeat(200);
    const spoken = toSpeechText(words, 50);
    expect(spoken.length).toBeLessThanOrEqual(51);
    // Every word that remains is whole, and the cut ends with a full stop.
    expect(spoken.split(' ').every((w) => w === 'word' || w === 'word.')).toBe(true);
    expect(spoken.endsWith('.')).toBe(true);
  });

  it('returns an empty string for an empty reply', () => {
    expect(toSpeechText('   ')).toBe('');
  });
});
