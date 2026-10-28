import { API_URL } from '@/lib/api';
import { signedIn } from '@/lib/session';

export async function GET(request: Request, ctx: RouteContext<'/api/runs/[id]/stream'>) {
  if (!(await signedIn())) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const headers = new Headers({ accept: 'text/event-stream' });
  const last = request.headers.get('last-event-id');
  if (last) headers.set('last-event-id', last);

  const upstream = await fetch(
    `${API_URL}/runs/${encodeURIComponent(id)}/stream${new URL(request.url).search}`,
    { headers, signal: request.signal, cache: 'no-store' },
  );
  if (!upstream.ok || !upstream.body) {
    return new Response(null, { status: upstream.ok ? 502 : upstream.status });
  }
  return new Response(upstream.body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
