import type { MetadataRoute } from 'next';

// Built once into out/manifest.webmanifest; the site is a static export.
export const dynamic = 'force-static';

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Lets phones add Myrs to the home screen and open it like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: `${base}/`,
    name: 'Myrs 你的我的共享平台',
    short_name: 'Myrs',
    description: '分享吾需⇄換取所需：在 1 公里內找到鄰居分享的食物與衣物。',
    lang: 'zh-Hant',
    start_url: `${base}/`,
    scope: `${base}/`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f6f8f7',
    theme_color: '#00A078',
    icons: [
      { src: `${base}/icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}/icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${base}/icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
