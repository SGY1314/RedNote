import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  resolve: { preserveSymlinks: true },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (req) => {
            req.removeHeader("origin");
            req.removeHeader("sec-fetch-site");
          });
        },
      },
    },
  },
  build: {
    emptyOutDir: false,
    rollupOptions: { preserveSymlinks: true },
    chunkSizeWarningLimit: 1500,
  },
});
