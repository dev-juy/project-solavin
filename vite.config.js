import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standard production build → dist/ (deployed to Netlify / static hosting).
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2019",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/lib/ivAnalysis.js"],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
    },
  },
});
