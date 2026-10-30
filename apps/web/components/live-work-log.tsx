'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { LivePhase, RunEvent } from '@/lib/types';
import { applyText, replyFrom, streamingReply, type StepTexts, type TextChunk } from '@/lib/reply';
import { MarkdownText } from './markdown';
import { WorkLog } from './work-log';

type Live = { attempt: number; events: RunEvent[]; phase: LivePhase | null; texts: StepTexts };
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
  const [live, setLive] = useState<Live>({ attempt, events, phase: null, texts: {} });
  const [since, setSince] = useState(startedAt);
  const [retry, setRetry] = useState(0);
  const [done, setDone] = useState<Done | null>(null);
  const latest = useRef(events);
  const latestTexts = useRef<StepTexts>({});
  const cursor = useRef({ attempt, after: events.at(-1)?.seq ?? -1 });

  useEffect(() => {
    const { attempt, after } = cursor.current;
    const source = new EventSource(`/api/runs/${runId}/stream?attempt=${attempt}&after=${after}`);
    let timer: ReturnType<typeof setTimeout> | undefined;

    source.addEventListener('attempt', (e) => {
      const { attempt } = JSON.parse(e.data) as { attempt: number };
      cursor.current = { attempt, after: -1 };
      latest.current = [];
      latestTexts.current = {};
      setLive({ attempt, events: [], phase: null, texts: {} });
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
    source.addEventListener('text', (e) => {
      const chunk = JSON.parse(e.data) as TextChunk;
      setLive((l) => {
        latestTexts.current = applyText(l.texts, chunk);
        return { ...l, texts: latestTexts.current };
      });
    });
    source.addEventListener('end', () => {
      source.close();
      setDone({
        reply: replyFrom(latest.current) ?? streamingReply(latest.current, latestTexts.current),
        finishedAt: new Date().toISOString(),
      });
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

  const reply = streamingReply(live.events, live.texts);
  return (
    <>
      <WorkLog
        events={live.events}
        active
        phase={live.phase}
        startedAt={since}
        finishedAt={null}
        reply={reply}
      />
      {reply && <MarkdownText>{reply}</MarkdownText>}
    </>
  );
}
