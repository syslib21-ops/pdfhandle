import { defineConfig } from "vite";

/**
 * GitHub Pages 프로젝트 사이트: https://<user>.github.io/<저장소이름>/
 * - 로컬 개발(`vite`): base `/`
 * - 빌드: `VITE_PAGES_BASE`가 있으면 사용(Actions에서 저장소명으로 설정), 없으면 `/pdfhandle/`
 *   저장소 이름이 pdfhandle이 아니면 아래 fallback 또는 Actions env를 맞추세요.
 */
export default defineConfig(({ command }) => {
  const dev = command === "serve";
  const envBase = process.env.VITE_PAGES_BASE?.trim();
  const fallbackRepo = "/pdfhandle/";
  const base = dev ? "/" : envBase || fallbackRepo;

  return {
    base,
    root: ".",
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
