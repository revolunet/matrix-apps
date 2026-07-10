import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";

// https://vite.dev/config/
// Note: vite-plugin-top-level-await is not needed with Vite 8 + target esnext
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/matrix-apps/" : "/",
  plugins: [react(), tailwindcss(), wasm()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  optimizeDeps: {
    exclude: ["@matrix-org/matrix-sdk-crypto-wasm"],
    include: ["matrix-js-sdk"],
  },
  build: { target: "esnext" },
}));
