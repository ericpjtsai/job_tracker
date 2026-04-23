/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@job-tracker/scoring'],
  // @sparticuz/chromium ships pre-built binaries — tell webpack not to bundle them
  experimental: {
    serverComponentsExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  },
}

export default nextConfig
