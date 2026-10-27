import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { appJwt } from '../src/jwt.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

describe('appJwt', () => {
  it('signs a short-lived RS256 token issued by the app', () => {
    const now = Date.UTC(2026, 9, 27, 12, 0, 0);
    const [header, payload, signature] = appJwt('12345', pem, now).split('.');
    const decode = (part: string) =>
      JSON.parse(Buffer.from(part, 'base64url').toString()) as unknown;

    expect(decode(header!)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decode(payload!)).toEqual({
      iss: '12345',
      iat: now / 1000 - 60,
      exp: now / 1000 - 60 + 540,
    });
    const valid = createVerify('RSA-SHA256')
      .update(`${header}.${payload}`)
      .verify(publicKey, Buffer.from(signature!, 'base64url'));
    expect(valid).toBe(true);
  });
});
