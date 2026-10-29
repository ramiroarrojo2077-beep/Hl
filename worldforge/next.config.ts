import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // El chequeo de tipos corre aparte con `npm run check` (TypeScript 7 nativo).
  typescript: { ignoreBuildErrors: true },
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
