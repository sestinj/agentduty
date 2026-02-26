import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  plugins: [
    {
      name: "fix-graphql-instanceof",
      transform(_code, id) {
        // Replace graphql's instanceOf with a version that falls back to
        // name comparison instead of throwing on cross-realm objects.
        // This fixes Vite loading graphql through both CJS and ESM paths.
        if (id.includes("graphql") && id.includes("instanceOf")) {
          return `
export const instanceOf = function instanceOf(value, constructor) {
  if (value instanceof constructor) return true;
  if (typeof value === "object" && value !== null) {
    const expected = constructor.prototype?.[Symbol.toStringTag] || constructor.name;
    const actual = Symbol.toStringTag in value
      ? value[Symbol.toStringTag]
      : value.constructor?.name;
    if (expected === actual) return true;
  }
  return false;
};
`;
        }
      },
    },
  ],
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    server: {
      deps: {
        // Force graphql through Vite's transform pipeline so our plugin
        // can patch instanceOf consistently across all load paths.
        inline: [/graphql/],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
