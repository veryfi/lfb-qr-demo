import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3060,
    proxy: {
      "/api": {
        target: "http://localhost:3061",
        changeOrigin: true,
      },
    },
  },
});
