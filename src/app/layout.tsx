import type { Metadata } from 'next';
import { Inter, Barlow_Condensed, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const bodyFont = Inter({
  variable: '--font-body',
  subsets: ['latin'],
});

const displayFont = Barlow_Condensed({
  variable: '--font-display',
  weight: ['500', '600', '700'],
  subsets: ['latin'],
});

const monoFont = JetBrains_Mono({
  variable: '--font-mono',
  weight: ['500', '600'],
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Power Mix One',
  description: 'An original virtual analog character console — tape, drive, and headroom, built by ear.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable} ${monoFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
