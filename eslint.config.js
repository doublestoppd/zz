// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

/**
 * Architectural boundaries enforced mechanically (see docs/ARCHITECTURE.md §Dependency rules).
 *
 * - The domain packages must never import rendering or networking frameworks.
 * - Authoritative simulation must never call Math.random(); randomness comes from the seeded Rng.
 * - Other packages may only import a package through its public entry point.
 */
const FRAMEWORK_MODULES = ["phaser", "ws", "colyseus", "socket.io", "socket.io-client"];

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/*.js", "**/*.cjs", "**/*.mjs"] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@zombie/*/src/*"],
              message: "Import a package through its public entry point, not its internals.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: FRAMEWORK_MODULES.map((name) => ({
            name,
            message: `Domain packages must not depend on ${name} (docs/ARCHITECTURE.md).`,
          })),
          patterns: [
            {
              group: ["@zombie/*/src/*"],
              message: "Import a package through its public entry point.",
            },
            {
              group: ["@zombie/server", "@zombie/client"],
              message: "Packages must not import apps.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/game-core/**/*.ts", "packages/map-generation/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message:
            "Authoritative simulation must use the seeded Rng (packages/game-core/src/random).",
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  prettier,
);
