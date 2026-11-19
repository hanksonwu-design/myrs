import type { Metadata, Viewport } from 'next';
import 'leaflet/dist/leaflet.css';
import './globals.css';
import { Providers } from '@/components/Providers';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Myrs 你的我的共享平台',
  description: '分享吾需⇄換取所需：在 1 公里內找到鄰居分享的食物與衣物。',
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/myrs-logo.png` },
};

export const viewport: Viewport = {
  themeColor: '#00A078',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body className="min-h-screen antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
