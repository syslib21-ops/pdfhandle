import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages 프로젝트 페이지(https://user.github.io/repo/)에서 자산 경로가 맞도록 상대 경로 사용
  base: "./",
  root: ".",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
