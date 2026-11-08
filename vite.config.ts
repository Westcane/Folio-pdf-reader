import { readFileSync, existsSync, cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode, command }) => {
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
  return {
    base: "./",
    server: { host: "0.0.0.0", port: 5173, strictPort: true, https },
    preview: { host: "0.0.0.0", port: 4173, strictPort: true, https },
    define: { __FOLIO_TEST_MODE__: JSON.stringify(testMode) },
    build: { target: "safari17.4", chunkSizeWarningLimit: 900 },
    plugins: [
      { name: "production-security-policy", transformIndexHtml() {
        if (command !== "build") return [];
        return [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' https://api.deepseek.com; object-src 'none'; base-uri 'self'; form-action 'self'" }, injectTo: "head-prepend" }];
      } },
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
          mkdirSync(resolve("public/licenses"), { recursive: true });
          cpSync(resolve("LICENSES/WebReader-MIT.txt"), resolve("public/licenses/WebReader-MIT.txt"));
          cpSync(resolve("node_modules/pdfjs-dist/LICENSE"), resolve("public/licenses/PDFjs-Apache-2.0.txt"));
        },
      },
      VitePWA({
        registerType: "prompt",
        includeAssets: ["icons/*.png", "icons/*.svg"],
        manifest: {
          name: "Folio · 本地 PDF 阅读",
          id: "./",
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
            "**/*.{html,js,mjs,css,svg,png,bcmap,pfb,ttf,wasm,pdf,bin,txt}",
          ],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          navigateFallback: "index.html",
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          runtimeCaching: [],
        },
        devOptions: { enabled: false },
        injectRegister: "auto",
      }),
    ],
    test: { include: ["src/**/*.test.ts"], environment: "node" },
  };
});
