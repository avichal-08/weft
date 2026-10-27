import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCsv } from '../src/csv.js';

describe('parseCsv', () => {
  it('parses simple rows', () => {
    assert.deepEqual(parseCsv('name,age\nada,36\nalan,41'), [
      ['name', 'age'],
      ['ada', '36'],
      ['alan', '41'],
    ]);
  });

  it('handles CRLF line endings and a trailing newline', () => {
    assert.deepEqual(parseCsv('a,b\r\nc,d\r\n'), [
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps empty fields', () => {
    assert.deepEqual(parseCsv('a,,c\n,,'), [
      ['a', '', 'c'],
      ['', '', ''],
    ]);
  });

  it('supports quoted fields containing commas', () => {
    assert.deepEqual(parseCsv('city,note\n"Paris, France","big, old"'), [
      ['city', 'note'],
      ['Paris, France', 'big, old'],
    ]);
  });

  it('supports escaped quotes and newlines inside quotes', () => {
    assert.deepEqual(parseCsv('quote\n"she said ""hi"""\n"line one\nline two"'), [
      ['quote'],
      ['she said "hi"'],
      ['line one\nline two'],
    ]);
  });

  it('rejects an unterminated quoted field', () => {
    assert.throws(() => parseCsv('"oops'), SyntaxError);
  });
});
