import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in · weft' };

export default function LoginPage() {
  return (
    <main className="grid flex-1 place-items-center px-6">
      <LoginForm />
    </main>
  );
}
