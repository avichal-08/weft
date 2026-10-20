import { Suspense } from 'react';
import { NewRunForm } from '@/components/new-run-form';
import { RunsList } from '@/components/runs-list';

export default function Home() {
  return (
    <div className="grid gap-10">
      <section>
        <h1 className="mb-1 text-xl font-semibold">New run</h1>
        <p className="mb-4 text-sm text-zinc-500">
          The agent works in an isolated sandbox and returns a diff once the tests pass.
        </p>
        <NewRunForm />
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">Runs</h2>
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading runs…</p>}>
          <RunsList />
        </Suspense>
      </section>
    </div>
  );
}
