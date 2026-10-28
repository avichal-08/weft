import { LogoMark } from '@/components/logo';
import { NewChatForm } from '@/components/new-chat-form';

export default function Home() {
  return (
    <div className="relative flex-1 overflow-y-auto">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_top,var(--accent-soft),transparent_70%)]" />
      <div className="relative mx-auto grid min-h-full max-w-2xl grid-cols-1 content-center gap-8 px-6 py-16">
        <div className="grid justify-items-center gap-4 text-center">
          <LogoMark className="size-11" />
          <h1 className="text-3xl font-semibold tracking-tight">What should we work on?</h1>
          <p className="max-w-md text-[15px] text-muted">
            Point weft at a repository and ask a question or describe a change. It explores the code
            in an isolated sandbox and shows every step.
          </p>
        </div>
        <NewChatForm />
      </div>
    </div>
  );
}
