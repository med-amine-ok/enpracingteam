import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true }, // "@/…" imports, as in tsconfig.json
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    // next-intl imports "next/server" without an extension, which Node alone cannot resolve.
    server: { deps: { inline: ["next-intl"] } },
  },
});
