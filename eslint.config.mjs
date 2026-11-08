// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-electron/**",
      "**/build/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/blob-report/**",
      "**/buildResources/**",
      "**/node_modules/**",
      "apps/server/fixtures/coding-eval/**",
      "packages/alb/**",
    ],
  },

  // Base rules for all TypeScript (and JavaScript) files.
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "no-console": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      // ESLint 10 recommended adds these; existing code is not ready yet.
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  // React hooks rules for the desktop app. Plugin v7's `recommended` preset
  // also enables React Compiler rules; keep the classic hooks set for now.
  {
    files: ["apps/desktop/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // CommonJS files (Electron main process): require() is the module system there.
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // Plain scripts: don't apply TS-only rules.
  {
    files: ["**/*.{mjs,cjs,js}"],
    ...tseslint.configs.disableTypeChecked,
  },

  {
    files: ["apps/chrome-extension/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        chrome: "readonly",
      },
    },
  },

  // Test files: mock generators may legitimately yield nothing; non-null
  // assertions are common when reaching into fixtures.
  {
    files: ["**/*.test.{ts,tsx}", "**/*.spec.ts", "**/*.mjs", "**/*.cjs"],
    rules: {
      "require-yield": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
