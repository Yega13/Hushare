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

  // A MUTATION SET IS DATA, NOT A MODULE.
  //
  // Every file in scripts/mutations is one manifest the runner imports by name:
  // { file, test, mutations }. import/no-anonymous-default-export is a readability rule about
  // CODE -- an exported thing nobody can name is hard to talk about -- and it does not apply to a
  // manifest whose name is its filename. Left on, it reported one finding per set (49 of them by
  // 2026-09-10) and the honest alternative was a line of ceremony in every file that said nothing.
  //
  // Scoped to this directory on purpose. The rule keeps meaning everywhere else, which is the
  // difference between an exception and a hole.
  {
    files: ["scripts/mutations/*.mjs"],
    rules: { "import/no-anonymous-default-export": "off" },
  },

  // A LEADING UNDERSCORE MEANS "DELIBERATELY UNUSED", and the convention has to be expressible or
  // it is not a convention. A test double must keep the real signature to type-check against it,
  // so its unused parameters are the point, not an oversight. Without this, the only ways to
  // silence one are to delete the type (losing the check the double exists for) or to add a
  // `void x` line, and both are worse than the warning.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
    },
  },
]);

export default eslintConfig;
