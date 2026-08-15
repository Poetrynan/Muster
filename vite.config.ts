import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // P1-5: production build optimization - WebView2 ships a modern engine (Chromium 100+),
  // so es2022 is safe to target, keeping the output leaner (no legacy polyfills) and the
  // first paint faster to parse. Manual chunk splitting lets the big dependencies
  // (framer-motion/lucide-react/tauri-api) be cached separately and downloaded in parallel.
  build: {
    target: "es2022",
    minify: "esbuild",
    cssMinify: true,
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return;
          // framer-motion v12 splits its implementation across two standalone packages,
          // motion-dom / motion-utils, so they must be grouped together or they fall
          // through into the vendor catch-all chunk.
          if (
            id.includes("framer-motion") ||
            id.includes("motion-dom") ||
            id.includes("motion-utils")
          ) {
            return "vendor-motion";
          }
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("@tauri-apps")) return "vendor-tauri";
          if (id.includes("zustand")) return "vendor-zustand";
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("scheduler")
          ) {
            return "vendor-react";
          }
          return "vendor";
        },
      },
    },
  },

  // In dev mode Vite does not bundle, so every module is one HTTP request. lucide-react has
  // 1500+ icons and framer-motion also has a huge number of modules; without pre-bundling
  // this produces thousands of requests, dragging cold start out to tens of seconds.
  // Adding them all to optimizeDeps.include lets esbuild pre-bundle them into a single file.
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "zustand",
      "zustand/middleware",
      "lucide-react",
      "framer-motion",
      "clsx",
      "tailwind-merge",
      "class-variance-authority",
      "@tauri-apps/api/core",
      "@tauri-apps/api/window",
      "@tauri-apps/api/event",
      "@tauri-apps/plugin-dialog",
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
