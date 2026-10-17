import { describe, expect, it } from 'vitest';
import { CappedBuffer } from '../src/output.ts';

const write = (buf: CappedBuffer, ...parts: string[]) =>
  new Promise<void>((resolve) => {
    for (const p of parts) buf.write(Buffer.from(p));
    buf.end(resolve);
  });

describe('CappedBuffer', () => {
  it('keeps everything under the cap', async () => {
    const buf = new CappedBuffer(100);
    await write(buf, 'hello ', 'world');
    expect(buf.text()).toBe('hello world');
    expect(buf.truncated).toBe(false);
    expect(buf.total).toBe(11);
  });

  it('keeps the head and counts the rest', async () => {
    const buf = new CappedBuffer(5);
    await write(buf, 'abc', 'defgh', 'ij');
    expect(buf.text()).toBe('abcde');
    expect(buf.truncated).toBe(true);
    expect(buf.total).toBe(10);
  });
});
