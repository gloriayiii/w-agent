import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Only API handlers and one internal page here — no image optimisation,
  // no i18n, nothing else to configure.
  reactStrictMode: true,
}

export default nextConfig
