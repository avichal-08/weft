'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { LivePhase, RunEvent } from '@/lib/types';
import { replyFrom } from '@/lib/reply';
import { MarkdownText } from './markdown';
import { WorkLog } from './work-log';

type Live = { attempt: number; events: RunEvent[]; phase: LivePhase | null };
type Done = { reply: string | null; finishedAt: string };

export function LiveWorkLog({
  runId,
  attempt,
  events,
  startedAt,
}: {
  runId: string;
  attempt: number;
  events: RunEvent[];
  startedAt: string | null;
}) {
  const router = useRouter();
  const [live, setLive] = useState<Live>({ attempt, events, phase: null });
  const [since, setSince] = useState(startedAt);
  const [retry, setRetry] = useState(0);
  const [done, setDone] = useState<Done | null>(null);
  const latest = useRef(events);
  const cursor = useRef({ attempt, after: events.at(-1)?.seq ?? -1 });

  useEffect(() => {
    const { attempt, after } = cursor.current;
    const source = new EventSource(`/api/runs/${runId}/stream?attempt=${attempt}&after=${after}`);
    let timer: ReturnType<typeof setTimeout> | undefined;

    source.addEventListener('attempt', (e) => {
      const { attempt } = JSON.parse(e.data) as { attempt: number };
      cursor.current = { attempt, after: -1 };
      latest.current = [];
      setLive({ attempt, events: [], phase: null });
    });
    source.addEventListener('phase', (e) => {
      const phase = JSON.parse(e.data) as LivePhase;
      setSince((s) => s ?? new Date().toISOString());
      setLive((l) => ({ ...l, phase }));
    });
    source.addEventListener('event', (e) => {
      const event = JSON.parse(e.data) as RunEvent;
      cursor.current = { ...cursor.current, after: event.seq };
      setLive((l) => {
        if (l.events.some((x) => x.seq === event.seq)) return l;
        latest.current = [...l.events, event];
        return { ...l, events: latest.current };
      });
    });
    source.addEventListener('end', () => {
      source.close();
      setDone({ reply: replyFrom(latest.current), finishedAt: new Date().toISOString() });
      router.refresh();
    });
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED)
        timer = setTimeout(() => setRetry((n) => n + 1), 3000);
    };

    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [runId, retry, router]);

  if (done) {
    return (
      <>
        <WorkLog
          events={live.events}
          active={false}
          startedAt={since}
          finishedAt={done.finishedAt}
          reply={done.reply}
        />
        {done.reply && <MarkdownText>{done.reply}</MarkdownText>}
      </>
    );
  }

  return (
    <WorkLog
      events={live.events}
      active
      phase={live.phase}
      startedAt={since}
      finishedAt={null}
      reply={null}
    />
  );
}
