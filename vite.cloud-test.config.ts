import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Separate output and entry point. Never builds/replaces the daily local app.
export default defineConfig({
  root: "cloud-preview",
  publicDir: "../cloud-preview-public",
  plugins: [react()],
  build: { outDir: "../dist-cloud-test", emptyOutDir: true },
  server: { host: "127.0.0.1" },
});
