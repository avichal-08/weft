import Link from 'next/link';
import { Suspense } from 'react';
import { RunDetail } from '@/components/run-detail';

export default function RunPage({ params }: PageProps<'/runs/[id]'>) {
  return (
    <div className="grid grid-cols-1 gap-6">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← All runs
      </Link>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading run…</p>}>
        <RunDetail params={params} />
      </Suspense>
    </div>
  );
}
