import { describe, expect, it } from 'vitest';
import { isTimeoutExit, wrapCommand } from '../src/command.ts';

describe('wrapCommand', () => {
  it('runs strings through sh under timeout', () => {
    expect(wrapCommand('npm test', 1500)).toEqual([
      'timeout',
      '--signal=TERM',
      '--kill-after=2',
      '1.5',
      'sh',
      '-c',
      'npm test',
    ]);
  });

  it('runs argv as-is under timeout', () => {
    expect(wrapCommand(['ls', '-la'], 60_000).slice(3)).toEqual(['60', 'ls', '-la']);
  });

  it('never passes a zero timeout, which would mean no timeout', () => {
    expect(wrapCommand('x', 0)[3]).toBe('0.001');
  });
});

describe('isTimeoutExit', () => {
  it('needs a timeout exit code and the deadline to have passed', () => {
    expect(isTimeoutExit(124, 1000, 1000)).toBe(true);
    expect(isTimeoutExit(137, 3100, 1000)).toBe(true);
    expect(isTimeoutExit(124, 10, 1000)).toBe(false);
    expect(isTimeoutExit(1, 5000, 1000)).toBe(false);
  });
});
