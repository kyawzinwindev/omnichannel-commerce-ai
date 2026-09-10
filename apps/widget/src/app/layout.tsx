import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Omnichannel AI Commerce Widget',
  description: 'Embeddable Intelligent Commerce AI Chat Widget',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}
