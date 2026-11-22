import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/.expo/**",
      "**/.turbo/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/next-env.d.ts",
      "packages/api-client/src/schema.d.ts",
      "packages/database/src/generated/**",
    ],
  },
  {
    files: ["**/*.{js,cjs,mjs,ts,tsx}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["apps/web-staff/**/*.{js,cjs,mjs,ts,tsx}"],
    extends: nextVitals,
    settings: { next: { rootDir: "apps/web-staff/" } },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports", prefer: "type-imports" },
      ],
    },
  },
  {
    // Nest uses emitted decorator metadata to resolve class providers.
    files: ["apps/api/**/*.ts"],
    rules: { "@typescript-eslint/consistent-type-imports": "off" },
  },
);
