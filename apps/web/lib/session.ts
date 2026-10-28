import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, sessionKey, verifySession } from './token';

export const authKey = () => sessionKey(process.env.SESSION_SECRET);

export async function signedIn(): Promise<boolean> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value, authKey());
}

export async function requireSession(): Promise<void> {
  if (!(await signedIn())) redirect('/login');
}
