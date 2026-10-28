import { ShieldAlert, TriangleAlert } from 'lucide-react';
import type { Finding } from '@/lib/types';

export function Checks({ findings }: { findings: Finding[] }) {
  const blocks = findings.filter((f) => f.severity === 'block');
  const warnings = findings.filter((f) => f.severity === 'warn');
  if (findings.length === 0) return null;

  return (
    <div className="grid gap-2 text-sm">
      {blocks.length > 0 && (
        <div className="rounded-lg border border-bad/25 bg-bad-soft px-3.5 py-2.5">
          <p className="flex items-center gap-2 font-medium text-bad">
            <ShieldAlert className="size-4 shrink-0" /> These changes can&apos;t be committed yet
          </p>
          <ul className="mt-1.5 grid gap-1 pl-6 text-[13px] text-muted">
            {blocks.map((f) => (
              <li key={`${f.kind}-${f.file}-${f.line ?? ''}`}>{f.message}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && <Warnings findings={warnings} />}
    </div>
  );
}

export function Warnings({ findings }: { findings: Finding[] }) {
  return (
    <div className="rounded-lg border border-warn/25 bg-warn-soft px-3.5 py-2.5">
      <p className="flex items-center gap-2 font-medium text-warn">
        <TriangleAlert className="size-4 shrink-0" /> Worth a look before committing
      </p>
      <ul className="mt-1.5 grid gap-1 pl-6 text-[13px] text-muted">
        {findings.map((f) => (
          <li key={`${f.kind}-${f.file}-${f.line ?? ''}`}>{f.message}</li>
        ))}
      </ul>
    </div>
  );
}
