import {
  ArrowRight,
  Box,
  FileSearch,
  GitPullRequest,
  MessageCircleQuestion,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PixelField } from '@/components/landing/pixel-field';
import { TurnDemo } from '@/components/landing/turn-demo';
import { Logo, LogoMark } from '@/components/logo';

const REPO = 'https://github.com/avichal-08/weft';

export const metadata: Metadata = {
  title: 'weft · the coding agent that shows its work',
  description:
    'Describe a fix or a feature. weft makes the change in an isolated sandbox, proves it against your tests, and opens the pull request.',
};

const PROVIDERS = ['Anthropic', 'OpenAI', 'Google Gemini', 'OpenRouter'];

const FEATURES = [
  {
    Icon: FileSearch,
    title: 'Knows your code',
    body: 'Ask how something works and get an answer grounded in the files and functions weft actually read, not a guess.',
  },
  {
    Icon: Box,
    title: 'Isolated by default',
    body: 'Every chat runs in its own sandbox with no network and no credentials, so nothing it tries can reach your machine or your secrets.',
  },
  {
    Icon: ShieldCheck,
    title: 'Proven, not promised',
    body: 'Before a change counts as done, your tests run again in a fresh environment. Anything that looks like a key or a weakened test is stopped at the door.',
  },
  {
    Icon: MessageCircleQuestion,
    title: 'Ask mode',
    body: 'Just want answers? Ask mode is read-only: weft can look at everything and change nothing.',
  },
  {
    Icon: Zap,
    title: 'Follow-ups in a second',
    body: 'Your chat keeps its workspace warm, so the next message picks up right where the last one left off.',
  },
  {
    Icon: GitPullRequest,
    title: 'Pull requests you’d write',
    body: 'Commit when you’re happy, with a message drafted for you. weft opens the pull request and keeps it up to date.',
  },
];

const FLOW = [
  ['Describe it', 'Point weft at a repository and say what you need, in plain words.'],
  ['Watch it work', 'Every search, edit and command streams in as it happens.'],
  ['Steer', 'Follow up, change course or ask why. It’s one conversation.'],
  ['Verify', 'Your tests run again in a clean sandbox before anything is done.'],
  ['Ship', 'Commit and open the pull request in two clicks.'],
];

const QUALITY = [
  ['Tasks completed correctly', '94%'],
  ['Bug fixes and new features', '100%'],
  ['Changes claimed but never made', '0'],
  ['Questions answered without touching code', '100%'],
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-accent uppercase">
      <span className="size-1.5 rounded-[1px] bg-accent" />
      {children}
    </p>
  );
}

function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-2 rounded-full bg-fg px-5 py-2.5 text-sm font-medium text-bg transition hover:opacity-90"
    >
      {children}
      <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
    </Link>
  );
}

export default function Welcome() {
  return (
    <div className="h-full w-full overflow-y-auto scroll-smooth">
      <header className="fixed inset-x-0 top-4 z-30 px-4">
        <nav className="mx-auto flex max-w-4xl items-center justify-between rounded-full border border-line-strong bg-surface/65 py-2 pr-2 pl-4 shadow-card backdrop-blur-xl">
          <Link href="/" aria-label="weft">
            <Logo gap="var(--surface)" />
          </Link>
          <div className="hidden items-center gap-1 text-[13px] text-muted sm:flex">
            <a href="#features" className="rounded-full px-3 py-1.5 transition hover:text-fg">
              Features
            </a>
            <a href="#how" className="rounded-full px-3 py-1.5 transition hover:text-fg">
              How it works
            </a>
            <a href="#quality" className="rounded-full px-3 py-1.5 transition hover:text-fg">
              Quality
            </a>
          </div>
          <Link
            href="/login"
            className="rounded-full bg-fg px-4 py-1.5 text-[13px] font-medium text-bg transition hover:opacity-90"
          >
            Sign in
          </Link>
        </nav>
      </header>

      <section className="relative isolate overflow-hidden">
        <PixelField className="[mask-image:radial-gradient(ellipse_75%_65%_at_50%_35%,black_20%,transparent_75%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[680px] bg-[radial-gradient(ellipse_50%_45%_at_50%_0%,var(--accent-soft),transparent)]" />
        <div className="relative mx-auto grid max-w-6xl gap-16 px-6 pt-40 pb-28 text-center">
          <div className="landing-rise mx-auto grid max-w-3xl justify-items-center gap-7">
            <a
              href="#features"
              className="group flex items-center gap-2 rounded-full border border-line-strong bg-surface/70 py-1 pr-3 pl-1 text-xs text-muted backdrop-blur transition hover:text-fg"
            >
              <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">
                New
              </span>
              Ask mode: answers without touching your code
              <ArrowRight className="size-3 transition group-hover:translate-x-0.5" />
            </a>
            <h1 className="text-[44px] leading-[1.02] font-semibold tracking-[-0.045em] text-balance sm:text-[76px]">
              Describe the change.
              <br />
              <span className="bg-gradient-to-b from-fg to-fg/45 bg-clip-text text-transparent">
                Review the pull request.
              </span>
            </h1>
            <p className="max-w-xl text-[17px] leading-8 text-pretty text-muted">
              weft is a coding agent for your GitHub repositories. It reads your code, makes the
              change in an isolated sandbox, proves it against your tests, and opens a pull request
              for you to review.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <PrimaryLink href="/login">Start a chat</PrimaryLink>
              <a
                href="#how"
                className="rounded-full border border-line-strong bg-surface/60 px-5 py-2.5 text-sm font-medium backdrop-blur transition hover:bg-surface-2"
              >
                See how it works
              </a>
            </div>
          </div>
          <TurnDemo />
        </div>
      </section>

      <section className="border-y border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-12 gap-y-4 px-6 py-8">
          <span className="text-xs text-faint">Bring the model you already use</span>
          {PROVIDERS.map((p) => (
            <span key={p} className="text-[15px] font-semibold tracking-tight text-muted">
              {p}
            </span>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto grid max-w-6xl scroll-mt-24 gap-14 px-6 py-28">
        <div className="mx-auto grid max-w-2xl justify-items-center gap-4 text-center">
          <Eyebrow>Features</Eyebrow>
          <h2 className="text-4xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
            Fast enough to hand off. Careful enough to trust.
          </h2>
          <p className="text-[17px] leading-7 text-muted">
            weft does the legwork, searching, editing and testing, inside guardrails it can’t step
            outside of.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ Icon, title, body }) => (
            <article
              key={title}
              className="group relative grid content-start gap-4 overflow-hidden rounded-2xl border border-line bg-surface p-7 transition hover:border-line-strong"
            >
              <div className="pointer-events-none absolute -top-24 -right-24 size-48 rounded-full bg-accent-soft opacity-0 blur-3xl transition group-hover:opacity-100" />
              <span className="grid size-10 place-items-center rounded-xl border border-line bg-surface-2 text-fg">
                <Icon className="size-[18px]" />
              </span>
              <div className="grid gap-2">
                <h3 className="text-[17px] font-medium tracking-tight">{title}</h3>
                <p className="text-sm leading-6 text-muted">{body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="how" className="scroll-mt-24 border-y border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-14 px-6 py-28">
          <div className="grid max-w-2xl gap-4">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="text-4xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
              From a sentence to a reviewed change.
            </h2>
          </div>
          <ol className="grid gap-8 md:grid-cols-5 md:gap-6">
            {FLOW.map(([name, body], i) => (
              <li key={name} className="grid content-start gap-3 border-t border-line-strong pt-5">
                <span className="font-mono text-xs text-accent tabular-nums">0{i + 1}</span>
                <h3 className="text-[17px] font-medium tracking-tight">{name}</h3>
                <p className="text-sm leading-6 text-muted">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        id="quality"
        className="mx-auto grid max-w-6xl scroll-mt-24 items-center gap-14 px-6 py-28 lg:grid-cols-[1.1fr_1fr]"
      >
        <div className="grid gap-5">
          <Eyebrow>Quality</Eyebrow>
          <h2 className="text-4xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
            Held to a bar you can measure.
          </h2>
          <p className="max-w-lg text-[17px] leading-7 text-muted">
            Every change to weft’s agent runs against a suite of real tasks, from bug fixes and
            features to follow-ups and trick questions, graded by hidden tests rather than by
            another AI.
          </p>
          <a
            href={`${REPO}/blob/main/packages/agent/eval/REPORT.md`}
            className="group flex w-fit items-center gap-1.5 text-sm font-medium text-fg"
          >
            Read the latest results
            <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
          </a>
        </div>
        <dl className="grid grid-cols-2 gap-4">
          {QUALITY.map(([label, value]) => (
            <div key={label} className="grid gap-2 rounded-2xl border border-line bg-surface p-6">
              <dd className="text-4xl font-semibold tracking-[-0.04em] tabular-nums">{value}</dd>
              <dt className="text-sm leading-5 text-muted">{label}</dt>
            </div>
          ))}
        </dl>
      </section>

      <section className="relative isolate overflow-hidden border-t border-line">
        <PixelField className="[mask-image:radial-gradient(ellipse_60%_80%_at_50%_100%,black_10%,transparent_70%)]" />
        <div className="relative mx-auto grid max-w-3xl justify-items-center gap-7 px-6 py-32 text-center">
          <LogoMark className="size-12" />
          <h2 className="text-4xl font-semibold tracking-[-0.04em] text-balance sm:text-6xl">
            What should we work on?
          </h2>
          <PrimaryLink href="/login">Start a chat</PrimaryLink>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-[13px] text-faint">
          <Logo />
          <div className="flex gap-6">
            <a href="#features" className="transition hover:text-fg">
              Features
            </a>
            <a href={`${REPO}/blob/main/docs/architecture.md`} className="transition hover:text-fg">
              Docs
            </a>
            <a href={REPO} className="transition hover:text-fg">
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
