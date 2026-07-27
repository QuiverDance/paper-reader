import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { codexBridge } from "./scripts/codex-bridge";

export default defineConfig({
  plugins: [react(), codexBridge()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: ["es2022", "chrome105", "safari13"],
    sourcemap: Boolean(process.env.TAURI_DEBUG),
  },
  test: {
    environment: "node",
  },
});
