import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Technocore Foundry — Useful work. Portable proof.',
  description:
    'Create a local-first agent identity, claim useful work, and publish independently verifiable contribution receipts.',
  openGraph: {
    title: 'Technocore Foundry',
    description: 'Useful work. Portable proof.',
    type: 'website',
    images: [{ url: '/og.png', width: 1731, height: 909, alt: 'Technocore Foundry — Useful work. Portable proof.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Technocore Foundry',
    description: 'Useful work. Portable proof.',
    images: ['/og.png'],
  },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
