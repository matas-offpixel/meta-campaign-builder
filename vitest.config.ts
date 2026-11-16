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
      "app/api/d2c/connections/__tests__/**/*.test.ts",
      "app/api/__tests__/**/*.test.ts",
      "app/api/meta/__tests__/agency-token-guard.test.ts",
    ],
  },
});
