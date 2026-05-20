import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const DEV_API = "http://127.0.0.1:3838";
const DEV_WS = "ws://127.0.0.1:3838";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": DEV_API,
      "/ws": { target: DEV_WS, ws: true },
      "/v": DEV_API,
      "/thumbs": DEV_API,
      "/assets/mermaid": DEV_API,
    },
  },
});
