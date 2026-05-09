import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/scraper/logs": {
        target: process.env.VITE_API_URL || "http://localhost:3000",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            proxyRes.headers["x-accel-buffering"] = "no";
          });
        },
      },
      "/api": { target: process.env.VITE_API_URL || "http://localhost:3000", changeOrigin: true },
      "/auth": { target: process.env.VITE_API_URL || "http://localhost:3000", changeOrigin: true },
    },
  },
});
