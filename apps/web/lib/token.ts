import { jwtVerify, SignJWT } from 'jose';

export const SESSION_COOKIE = 'weft_session';
export const SESSION_DAYS = 7;
const MIN_SECRET_CHARS = 32;

export function sessionKey(secret: string | undefined): Uint8Array | null {
  return secret && secret.length >= MIN_SECRET_CHARS ? new TextEncoder().encode(secret) : null;
}

export async function signSession(key: Uint8Array, now = new Date()): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('owner')
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(now.getTime() / 1000) + SESSION_DAYS * 86_400)
    .sign(key);
}

export async function verifySession(
  token: string | undefined,
  key: Uint8Array | null,
): Promise<boolean> {
  if (!token || !key) return false;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], subject: 'owner' });
    return payload.sub === 'owner';
  } catch {
    return false;
  }
}
