import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
  test: {
    environment: "jsdom",
    include: [
      "components/library/__tests__/**/*.test.tsx",
      "components/dashboard/events/creative-lab/__tests__/**/*.test.tsx",
      "components/steps/__tests__/**/*.test.tsx",
      "components/dashboard/events/__tests__/**/*.test.tsx",
      "components/dashboard/sales/__tests__/**/*.test.tsx",
    ],
  },
});
