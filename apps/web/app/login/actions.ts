'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyPassword } from '@/lib/password';
import { rateLimiter } from '@/lib/rate-limit';
import { authKey } from '@/lib/session';
import { SESSION_COOKIE, SESSION_DAYS, signSession } from '@/lib/token';

const allow = rateLimiter(5, 60_000);

const clientIp = async () =>
  (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

export async function loginAction(
  _prev: { error?: string },
  form: FormData,
): Promise<{ error?: string }> {
  const key = authKey();
  const stored = process.env.WEFT_PASSWORD_HASH;
  if (!key || !stored) {
    return { error: 'Sign-in is not configured: set WEFT_PASSWORD_HASH and SESSION_SECRET.' };
  }
  if (!allow(await clientIp())) return { error: 'Too many attempts. Try again in a minute.' };

  const password = String(form.get('password') ?? '');
  if (!password || !(await verifyPassword(password, stored))) {
    return { error: 'Wrong password.' };
  }
  (await cookies()).set(SESSION_COOKIE, await signSession(key), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
  redirect('/chat');
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
