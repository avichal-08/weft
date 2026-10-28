import Link from 'next/link';
import { Suspense } from 'react';
import { RunDetail } from '@/components/run-detail';

export default function RunPage({ params }: PageProps<'/runs/[id]'>) {
  return (
    <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-6 overflow-y-auto px-6 py-8">
      <Link
        href="/chat"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        ← Back to chats
      </Link>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading run…</p>}>
        <RunDetail params={params} />
      </Suspense>
    </div>
  );
}
