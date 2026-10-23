import type { Metadata, Viewport } from 'next';
import { Fira_Code } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// Self-hosted by next/font, so the CSP's font-src 'self' still holds.
const firaCode = Fira_Code({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Passline',
  description: 'Event passes and check-in',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#05081a',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={firaCode.variable}>
      <body>{children}</body>
    </html>
  );
}
