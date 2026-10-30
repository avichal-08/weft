import { describe, expect, it } from 'vitest';
import { TEXT_FLUSH_MS, textStream, type TextChunk } from '../src/text-stream.ts';

function setup() {
  const sent: TextChunk[] = [];
  const pending: { fn: () => void; ms: number }[] = [];
  const stream = textStream((c) => sent.push(c), {
    set: (fn, ms) => pending.push({ fn, ms }),
    clear: () => {
      pending.length = 0;
    },
  });
  const tick = () => pending.splice(0).forEach((t) => t.fn());
  return { sent, pending, stream, tick };
}

describe('textStream', () => {
  it('batches pieces into one chunk per tick, each with the offset it starts at', () => {
    const { sent, pending, stream, tick } = setup();
    stream.push(1, { type: 'text', text: 'It ' });
    stream.push(1, { type: 'text', text: 'adds ' });
    expect(sent).toEqual([]);
    expect(pending.map((p) => p.ms)).toEqual([TEXT_FLUSH_MS]);
    tick();
    stream.push(1, { type: 'text', text: 'numbers.' });
    tick();
    expect(sent).toEqual([
      { step: 1, offset: 0, text: 'It adds ' },
      { step: 1, offset: 8, text: 'numbers.' },
    ]);
  });

  it("flushes a step's text before its event, and everything on close", () => {
    const { sent, stream } = setup();
    stream.push(1, { type: 'text', text: 'Looking.' });
    stream.flush(1);
    stream.push(2, { type: 'text', text: 'Done' });
    stream.close();
    expect(sent).toEqual([
      { step: 1, offset: 0, text: 'Looking.' },
      { step: 2, offset: 0, text: 'Done' },
    ]);
  });

  it('clears a step on reset, so a retried reply starts again from zero', () => {
    const { sent, stream, tick } = setup();
    stream.push(3, { type: 'text', text: 'half a rep' });
    tick();
    stream.push(3, { type: 'reset' });
    stream.push(3, { type: 'text', text: 'full' });
    tick();
    expect(sent).toEqual([
      { step: 3, offset: 0, text: 'half a rep' },
      { step: 3, offset: 0, text: '' },
      { step: 3, offset: 0, text: 'full' },
    ]);
  });
});
