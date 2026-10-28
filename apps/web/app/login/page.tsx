import type { Metadata } from 'next';
import Link from 'next/link';
import { PixelField } from '@/components/landing/pixel-field';
import { Logo } from '@/components/logo';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in · weft' };

export default function LoginPage() {
  return (
    <main className="relative isolate grid flex-1 place-items-center overflow-hidden px-6">
      <PixelField className="-z-10 [mask-image:radial-gradient(ellipse_55%_55%_at_50%_45%,black_10%,transparent_70%)]" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_40%_35%_at_50%_40%,var(--accent-soft),transparent)]" />
      <Link href="/" className="absolute top-6 left-6" aria-label="weft home">
        <Logo />
      </Link>
      <LoginForm />
    </main>
  );
}
