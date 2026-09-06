import './index.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Astra AI',
  description: "Hello, I'm ✴️ Astra. Ask me anything you want.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}
