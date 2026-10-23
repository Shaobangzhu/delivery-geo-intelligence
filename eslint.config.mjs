import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/dist-e2e/**", "reports/**"] },
  {
    files: ["**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: { globals: globals.node },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true }]
    }
  },
  { files: ["e2e/arcgis-runtime.mjs"], languageOptions: { globals: globals.browser } },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["backend/**/*.ts", "frontend/**/*.{ts,tsx}", "e2e/**/*.ts", "playwright.config.ts"]
  })),
  {
    files: ["backend/**/*.ts", "frontend/**/*.{ts,tsx}", "e2e/**/*.ts", "playwright.config.ts"],
    rules: {
      ...js.configs.recommended.rules,
      // TypeScript resolves names and already enforces unused locals/parameters.
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true }]
    }
  },
  { files: ["backend/**/*.ts"], languageOptions: { globals: globals.node } },
  {
    files: ["frontend/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error"
    }
  }
];
