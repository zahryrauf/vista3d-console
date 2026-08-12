import type { NextConfig } from "next";

/**
 * Next.js configuration for the Vista‑3D console.
 *
 * The original setup added a custom `webpack` configuration to tweak
 * `watchOptions` and avoid EMFILE errors. However, Next.js 16 uses Turbopack
 * by default, and providing a `webpack` config without an explicit
 * `turbopack` configuration triggers a build error.
 *
 * To resolve the conflict we remove the custom `webpack` hook and instead
 * provide an empty `turbopack` configuration, which silences the warning.
 * If you still encounter EMFILE limits, you can increase the system file
 * descriptor limit (`ulimit -n`) or configure Turbopack's own watch options
 * via the `turbopack` field (see Next.js docs).
 */
const nextConfig: NextConfig = {
  // Explicitly opt‑in to the default Turbopack behaviour.
  turbopack: {},
  // Additional Next.js options can be added here.
};

export default nextConfig;
