import { join } from "node:path";
import type { NextConfig } from "next";

/*
 * On Vercel (VERCEL=1 during the build) narration and captions run on the voice service
 * (LVS_VOICE_SERVICE_URL), so the native voice engine and its models are left out of the functions.
 * They are never bundled in any case: the models (~190 MB) are downloaded separately.
 */
const onVercel = !!process.env.VERCEL;
const traceExcludes = [
  "../../packages/voice/models/**",
  "../../packages/ai-motion/models/**",
  "../../node_modules/onnxruntime-node/**",
  ...(onVercel ? ["../../node_modules/sherpa-onnx-*/**", "../../node_modules/sherpa-onnx-node/**"] : []),
];

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
  // the npm workspace root, so server functions include the shared packages (Vercel monorepo)
  outputFileTracingRoot: join(__dirname, "..", ".."),
  outputFileTracingExcludes: { "/**/*": traceExcludes },
  poweredByHeader: false,
  transpilePackages: ["@lvs/camera-presets", "@lvs/voice", "@lvs/render-worker"],
  // native add-ons load from node_modules at runtime (the on-server voice engine)
  serverExternalPackages: ["@lvs/fablecut-core", "sherpa-onnx-node"],
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
