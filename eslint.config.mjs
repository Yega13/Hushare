import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build OUTPUT, not source. Without these, `npm run lint` walked the bundled Worker and
    // reported 34,315 problems — burying the ~80 real ones in src/ so completely that the command
    // was unusable and therefore unused. Linting generated code tells you nothing: nobody is going
    // to fix a minifier's duplicate case clause.
    ".open-next/**",
    ".wrangler/**",
  ]),
]);

export default eslintConfig;
