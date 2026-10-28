import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, sessionKey, verifySession } from '@/lib/token';

export async function proxy(request: NextRequest) {
  const ok = await verifySession(
    request.cookies.get(SESSION_COOKIE)?.value,
    sessionKey(process.env.SESSION_SECRET),
  );
  if (ok) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  matcher: ['/((?!(?:login|healthz)(?:/|$)|_next/static|_next/image|favicon.ico).*)'],
};
