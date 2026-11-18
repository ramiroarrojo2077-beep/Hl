import { defineConfig, type Plugin } from "vite";
import { cp, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";

const CESIUM_BUILD = path.resolve("node_modules/cesium/Build/Cesium");
const CESIUM_DIRS = ["Workers", "Assets", "ThirdParty", "Widgets"];

const MIME: Record<string, string> = {
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".xml": "application/xml",
  ".glb": "model/gltf-binary",
  ".ktx2": "image/ktx2",
};

/** Sirve (dev) y copia (build) los recursos estáticos de Cesium bajo /cesium/. */
function cesiumStatic(): Plugin {
  let outDir = "dist";
  return {
    name: "earth-next:cesium-static",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use("/cesium", async (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]!);
        const file = path.join(CESIUM_BUILD, path.normalize(rel).replace(/^([/\\])+/, ""));
        if (!file.startsWith(CESIUM_BUILD)) return next();
        try {
          const s = await stat(file);
          if (!s.isFile()) return next();
          res.setHeader("Content-Type", MIME[path.extname(file)] ?? "application/octet-stream");
          res.setHeader("Cache-Control", "public, max-age=3600");
          createReadStream(file).pipe(res);
        } catch {
          next();
        }
      });
    },
    async closeBundle() {
      for (const d of CESIUM_DIRS) await cp(path.join(CESIUM_BUILD, d), path.join(outDir, "cesium", d), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [cesiumStatic()],
  define: { CESIUM_BASE_URL: JSON.stringify("/cesium/") },
  server: {
    port: 5173,
    proxy: { "/api": { target: `http://localhost:${process.env.API_PORT ?? 8787}`, changeOrigin: false } },
  },
  preview: { proxy: { "/api": { target: `http://localhost:${process.env.API_PORT ?? 8787}` } } },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 6000,
    sourcemap: false,
    rollupOptions: { output: { manualChunks: (id: string) => (id.includes("node_modules/@cesium") || id.includes("node_modules/cesium") ? "cesium" : undefined) } },
  },
  worker: { format: "es" },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
} as never);
