/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  webpack: (config) => {
    // The shared workspace (../shared) uses NodeNext-ESM style `./x.js` specifiers that
    // point at `.ts` sources; let webpack resolve them the way tsc does.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
  // Baseline response headers (11-security-hardening: headers on every response).
  // A full script-src CSP needs per-request nonces for Next's inline scripts and
  // the Meta Pixel, so only the non-breaking directives are set here.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
  images: {
    // Supabase Storage public bucket URLs (13-homepage-cms §13.11, backend
    // plan §2) — homepage/campaign images and, later, product images all
    // resolve to this one host pattern, matching next/image's requirement
    // that every external image host be explicitly allowlisted.
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' }],
  },
};

export default nextConfig;
