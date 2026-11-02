import type { NextConfig } from "next";

/* Static security headers. The Content-Security-Policy (with a per-request
   nonce) is set in src/middleware.ts. */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@lvs/camera-presets"],
  serverExternalPackages: ["@lvs/fablecut-core"],
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  webpack(config, { isServer }) {
    if (isServer) {
      // Vendored FableCut uses runtime require() between its own files: load it from
      // node_modules at runtime instead of bundling it.
      config.externals = [...(Array.isArray(config.externals) ? config.externals : [config.externals]).filter(Boolean),
        { "@lvs/fablecut-core": "commonjs @lvs/fablecut-core" }];
    }
    return config;
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
