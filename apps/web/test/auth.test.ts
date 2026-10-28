import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../lib/password';
import { rateLimiter } from '../lib/rate-limit';
import { sessionKey, signSession, verifySession } from '../lib/token';

describe('password', () => {
  it('verifies the right password and rejects anything else', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(stored).toMatch(/^scrypt:32768:8:1:[^:]+:[^:]+$/);
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('correct horse batter', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('salts every hash and rejects malformed ones', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
    expect(await verifyPassword('x', 'plain-text')).toBe(false);
    expect(await verifyPassword('x', 'scrypt:1:1:1::')).toBe(false);
  });
});

describe('session token', () => {
  const key = sessionKey('k'.repeat(32))!;

  it('needs a secret of at least 32 characters', () => {
    expect(sessionKey(undefined)).toBeNull();
    expect(sessionKey('short')).toBeNull();
    expect(key).toBeInstanceOf(Uint8Array);
  });

  it('accepts its own tokens until they expire', async () => {
    expect(await verifySession(await signSession(key), key)).toBe(true);
    const old = await signSession(key, new Date(Date.now() - 8 * 86_400_000));
    expect(await verifySession(old, key)).toBe(false);
  });

  it('rejects tokens signed with another key, tampered or unsigned', async () => {
    const other = sessionKey('o'.repeat(32))!;
    expect(await verifySession(await signSession(other), key)).toBe(false);
    const token = await signSession(key);
    expect(await verifySession(`${token.slice(0, -2)}xx`, key)).toBe(false);
    const [, body] = token.split('.');
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${body}.`;
    expect(await verifySession(none, key)).toBe(false);
    expect(await verifySession(undefined, key)).toBe(false);
    expect(await verifySession(token, null)).toBe(false);
  });

  it('rejects a valid signature for another subject', async () => {
    const stranger = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('someone')
      .setExpirationTime('1h')
      .sign(key);
    expect(await verifySession(stranger, key)).toBe(false);
  });
});

describe('rateLimiter', () => {
  it('allows the limit per window, per key', () => {
    let now = 0;
    const allow = rateLimiter(2, 60_000, () => now);
    expect([allow('a'), allow('a'), allow('a'), allow('b')]).toEqual([true, true, false, true]);
    now = 60_001;
    expect(allow('a')).toBe(true);
  });
});
