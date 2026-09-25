/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // Supabase Storage public bucket URLs (13-homepage-cms §13.11, backend
    // plan §2) — homepage/campaign images and, later, product images all
    // resolve to this one host pattern, matching next/image's requirement
    // that every external image host be explicitly allowlisted.
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' }],
  },
};

export default nextConfig;
