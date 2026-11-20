import type { Metadata, Viewport } from 'next';
import 'leaflet/dist/leaflet.css';
import './globals.css';
import { Providers } from '@/components/Providers';
import { AppShell } from '@/components/AppShell';

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const metadata: Metadata = {
  title: 'Myrs 你的我的共享平台',
  description: '分享吾需⇄換取所需：在 1 公里內找到鄰居分享的食物與衣物。',
  icons: {
    icon: [
      { url: `${base}/icons/favicon-48.png`, sizes: '48x48', type: 'image/png' },
      { url: `${base}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
    ],
    apple: `${base}/icons/apple-touch-icon.png`,
  },
  // Opened from the iPhone home screen: full screen, named Myrs.
  appleWebApp: { capable: true, title: 'Myrs', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  // Next writes the newer mobile-web-app-capable; iPhones before iOS 16.4 still read this one.
  other: { 'apple-mobile-web-app-capable': 'yes' },
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
