'use client';

import { MessageCircleQuestion } from 'lucide-react';
import { createContext, useContext, useOptimistic, type ReactNode } from 'react';
import type { RunMode } from '@/lib/types';
import { LogoMark } from './logo';
import { WorkLog } from './work-log';

type Pending = { message: string; mode: RunMode };

const PendingContext = createContext<{
  pending: Pending | null;
  show: (pending: Pending) => void;
}>({ pending: null, show: () => {} });

export function PendingTurnProvider({ children }: { children: ReactNode }) {
  const [pending, show] = useOptimistic<Pending | null, Pending>(null, (_, next) => next);
  return <PendingContext value={{ pending, show }}>{children}</PendingContext>;
}

export const useShowPendingTurn = () => useContext(PendingContext).show;

export function PendingTurn() {
  const { pending } = useContext(PendingContext);
  if (!pending) return null;
  return (
    <li className="grid grid-cols-1 gap-6">
      <div className="ml-auto grid max-w-[85%] justify-items-end gap-1">
        {pending.mode === 'ask' && (
          <span className="flex items-center gap-1 text-[11px] text-faint">
            <MessageCircleQuestion className="size-3" /> Ask · read-only
          </span>
        )}
        <div className="rounded-2xl rounded-br-md border border-line bg-surface-2 px-4 py-2.5 text-[15px] leading-7 [overflow-wrap:anywhere] whitespace-pre-wrap">
          {pending.message}
        </div>
      </div>
      <div className="flex gap-3.5">
        <LogoMark className="mt-0.5 size-6 shrink-0" />
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-3">
          <WorkLog events={[]} active startedAt={null} finishedAt={null} reply={null} />
        </div>
      </div>
    </li>
  );
}
