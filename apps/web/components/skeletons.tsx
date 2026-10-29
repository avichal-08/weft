import { LogoMark } from './logo';

const Bar = ({ className }: { className: string }) => (
  <div className={`skeleton rounded-md ${className}`} />
);

export function ChatSkeleton() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" aria-busy aria-label="Loading chat">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="grid min-w-0 flex-1 gap-1.5">
          <Bar className="h-4 w-48 max-w-[60%]" />
          <Bar className="h-3 w-32 max-w-[40%]" />
        </div>
        <Bar className="h-8 w-8 rounded-full sm:w-24" />
        <Bar className="h-8 w-8 rounded-full sm:w-28" />
      </header>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6">
        <div className="grid flex-1 content-start gap-10 pt-10">
          <div className="ml-auto w-[min(26rem,80%)]">
            <Bar className="h-12 rounded-2xl rounded-br-md" />
          </div>
          <div className="flex gap-3.5">
            <LogoMark className="mt-0.5 size-6 shrink-0 animate-pulse" />
            <div className="grid flex-1 gap-2.5">
              <Bar className="h-4 w-40" />
              <Bar className="h-3.5 w-full" />
              <Bar className="h-3.5 w-11/12" />
              <Bar className="h-3.5 w-3/5" />
            </div>
          </div>
        </div>
        <div className="pt-8 pb-5">
          <Bar className="h-[92px] rounded-[22px]" />
        </div>
      </div>
    </div>
  );
}

export function RunSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-8" aria-busy aria-label="Loading run">
      <div className="grid gap-2.5">
        <Bar className="h-5 w-24 rounded-full" />
        <Bar className="h-6 w-3/4" />
        <Bar className="h-4 w-1/2" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Bar key={i} className="h-[68px] rounded-lg" />
        ))}
      </div>
      <div className="grid gap-3">
        <Bar className="h-4 w-20" />
        {[0, 1, 2, 3].map((i) => (
          <Bar key={i} className="h-10 rounded-md" />
        ))}
      </div>
    </div>
  );
}
