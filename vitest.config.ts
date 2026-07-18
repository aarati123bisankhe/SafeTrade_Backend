import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.spec.ts",
      "src/**/*.test.ts",
      "src/**/*.spec.ts",
    ],
    setupFiles: ["./tests/setup.ts"],
    environment: "node",
    globals: true,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
