import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    // Not this app — see .gitignore.
    "ridelens/**",
    // Upstream MapLibre, copied out of node_modules at build time.
    "public/vendor/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
