import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'BidForge — RFP intelligence, engineered',
  description:
    'Turn an RFP or job-post URL into proposal-ready intelligence with web extraction, portfolio-aware RAG, and a multi-agent review workflow.',
  applicationName: 'BidForge',
  themeColor: '#111713',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body>{children}</body>
    </html>
  );
}
