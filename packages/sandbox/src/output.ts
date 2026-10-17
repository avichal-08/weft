import { Writable } from 'node:stream';

export class CappedBuffer extends Writable {
  private readonly maxBytes: number;
  private readonly chunks: Buffer[] = [];
  private kept = 0;
  total = 0;

  constructor(maxBytes: number) {
    super();
    this.maxBytes = maxBytes;
  }

  override _write(chunk: Buffer, _enc: BufferEncoding, done: () => void) {
    this.total += chunk.length;
    const room = this.maxBytes - this.kept;
    if (room > 0) {
      const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
      this.chunks.push(part);
      this.kept += part.length;
    }
    done();
  }

  get truncated(): boolean {
    return this.total > this.kept;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}
