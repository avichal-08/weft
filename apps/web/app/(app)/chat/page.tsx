import { PixelField } from '@/components/landing/pixel-field';
import { NewChatForm } from '@/components/new-chat-form';

export default function NewChat() {
  return (
    <div className="relative isolate flex-1 overflow-y-auto">
      <PixelField className="-z-10 [mask-image:radial-gradient(ellipse_70%_45%_at_50%_0%,black_10%,transparent_70%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 bg-[radial-gradient(ellipse_55%_60%_at_50%_0%,var(--accent-soft),transparent)]" />
      <div className="relative mx-auto grid min-h-full max-w-2xl grid-cols-1 content-center gap-9 px-6 py-16">
        <div className="landing-rise grid grid-cols-1 justify-items-center gap-3 text-center">
          <h1 className="text-[40px] leading-[1.05] font-semibold tracking-[-0.045em] text-balance sm:text-5xl">
            What should we work on?
          </h1>
          <p className="max-w-md text-[15px] leading-7 text-muted">
            Point weft at a GitHub repository, then ask a question or describe a change.
          </p>
        </div>
        <NewChatForm />
      </div>
    </div>
  );
}
