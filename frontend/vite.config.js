import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // 개발 중에는 프론트엔드에서 /api/* 요청을 백엔드(Flask)로 프록시할 수 있습니다.
    proxy: {
      "/compute": {
        target: "http://localhost:5000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/compute/, "/compute"),
      },
      "/question": {
        target: "http://localhost:5000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/question/, "/question"),
      },
    },
  },
});
