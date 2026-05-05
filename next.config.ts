import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Force this app folder as the tracing root (fixes parent `Desktop/package-lock.json` confusing Next). */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
