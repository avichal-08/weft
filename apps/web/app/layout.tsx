import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

const SITE_URL = process.env.SITE_URL ?? 'https://weft.avichal.me';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'weft',
  description:
    'Describe a fix or a feature. weft makes the change in an isolated sandbox, proves it against your tests, and opens the pull request.',
  openGraph: { type: 'website', siteName: 'weft', url: '/' },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex h-full overflow-hidden">{children}</body>
    </html>
  );
}
