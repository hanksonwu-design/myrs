import type { NextConfig } from 'next';

// GitHub Pages serves the site from /<repository name>; the deploy workflow
// (.github/workflows/deploy.yml) passes that in. Empty for local development.
const basePath = process.env.PAGES_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The floating dev badge sits on top of the mobile bottom nav.
  devIndicators: false,
  // Plain static files in out/, so any static host (GitHub Pages) can serve the site.
  output: 'export',
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
