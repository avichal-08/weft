import Link from 'next/link';
import { Suspense } from 'react';
import { RunDetail } from '@/components/run-detail';
import { RunSkeleton } from '@/components/skeletons';

export default function RunPage({ params }: PageProps<'/runs/[id]'>) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <Link href="/chat" className="w-fit text-sm text-muted transition hover:text-fg">
          ← Back
        </Link>
        <Suspense fallback={<RunSkeleton />}>
          <RunDetail params={params} />
        </Suspense>
      </div>
    </div>
  );
}
