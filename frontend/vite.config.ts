import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    // Dev server talks to the Go backend; in production Go serves the build.
    proxy: { "/api": "http://127.0.0.1:4444" },
  },
});
