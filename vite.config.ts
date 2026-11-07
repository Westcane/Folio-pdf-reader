import { readFileSync, existsSync, cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import type { Connect } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const cert = resolve(".cert/lan.pem");
  const key = resolve(".cert/lan-key.pem");
  if (mode === "https" && (!existsSync(cert) || !existsSync(key))) {
    throw new Error(
      "请先按 README 的 HTTPS 步骤生成 .cert/lan.pem 与 .cert/lan-key.pem",
    );
  }
  const https =
    mode === "https"
      ? { cert: readFileSync(cert), key: readFileSync(key) }
      : undefined;
  const testMode = process.env.FOLIO_TEST_MODE === "1";
  const proxy = testMode ? undefined : { "/api": { target: "http://127.0.0.1:8787", changeOrigin: false } };
  const blockPaidApi = (server: { middlewares: Connect.Server }) => {
    if (!testMode) return;
    server.middlewares.use("/api", (_request, response) => {
      response.statusCode = 503;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(JSON.stringify({ error: "测试服务器禁止真实 API 转发。", testMode: true }));
    });
  };
  return {
    base: "./",
    server: { host: "0.0.0.0", port: 5173, strictPort: true, https, proxy },
    preview: { host: "0.0.0.0", port: 4173, strictPort: true, https, proxy },
    build: { target: "safari17.4", chunkSizeWarningLimit: 900 },
    plugins: [
      { name: "block-paid-api-in-tests", configureServer: blockPaidApi, configurePreviewServer: blockPaidApi },
      react(),
      {
        name: "local-pdf-assets",
        // Vite serves these local files in development; production copies are precached too.
        buildStart() {
          for (const folder of ["cmaps", "standard_fonts", "wasm"]) {
            const dest = resolve("public/pdf-assets", folder);
            mkdirSync(dest, { recursive: true });
            cpSync(resolve("node_modules/pdfjs-dist", folder), dest, {
              recursive: true,
            });
          }
        },
      },
      VitePWA({
        registerType: "prompt",
        includeAssets: ["icons/*.png", "icons/*.svg"],
        manifest: {
          name: "Folio · 本地 PDF 阅读",
          short_name: "Folio",
          lang: "zh-CN",
          description: "在设备上重排、阅读和校对文字型 PDF。",
          display: "standalone",
          start_url: "./",
          scope: "./",
          theme_color: "#f7f6f2",
          background_color: "#f7f6f2",
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
            {
              src: "icons/icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "icons/icon-maskable.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          globPatterns: [
            "**/*.{html,js,mjs,css,svg,png,bcmap,pfb,ttf,wasm,pdf,bin}",
          ],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          navigateFallback: "index.html",
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
          runtimeCaching: [],
        },
        devOptions: { enabled: false },
      }),
    ],
    test: { include: ["src/**/*.test.ts"], environment: "node" },
  };
});
