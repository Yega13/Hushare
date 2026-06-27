/**
 * Post-build patch for the Cloudflare Worker bundle.
 *
 * In Cloudflare Workers (ESM context), `__filename` is undefined — it's a CJS-only
 * global. The Turbopack runtime computes:
 *   RUNTIME_ROOT = path.resolve(__filename, relativePathToRuntimeRoot)
 * at module-init time. When __filename is undefined, path.resolve() throws a TypeError,
 * causing the turbopack runtime factory to abort. The esbuild __commonJS wrapper then
 * marks the module as "attempted" (mod = {exports:{}}), so every subsequent call
 * returns {} instead of re-running the factory. This cascades: require_page19() returns
 * {}, ComponentMod = {}, ComponentMod.handler is not a function → HTTP 500.
 *
 * Fix: replace path.resolve(__filename, with path.resolve("", so the path resolves
 * relative to CWD instead of an undefined filename. RUNTIME_ROOT is only used for
 * chunk loading paths that are already patched away by requireChunk, so a CWD-based
 * root has no functional impact.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const handlerPath = resolve(
  ".open-next/server-functions/default/handler.mjs"
);

let content;
try {
  content = readFileSync(handlerPath, "utf-8");
} catch {
  console.error(`[patch-worker] handler.mjs not found at ${handlerPath}`);
  process.exit(1);
}

// esbuild may alias `path` as `path2`, `path3`, etc. to avoid variable collisions,
// so match any path-like alias name rather than a literal "path".
const pattern = /(\bpath\w*)\.resolve\(__filename,/g;

const before = content;
content = content.replace(pattern, '$1.resolve("",');

const count = (before.match(pattern) || []).length;

if (before === content) {
  if (content.includes('.resolve("",')) {
    console.log("[patch-worker] handler.mjs already patched — nothing to do");
  } else {
    console.warn(
      "[patch-worker] WARNING: expected pattern not found in handler.mjs — " +
        "the fix may not have applied. Double-check the runtime output."
    );
  }
} else {
  writeFileSync(handlerPath, content);
  console.log(
    `[patch-worker] Patched handler.mjs: replaced ${count} occurrence(s) of ` +
      "path[N].resolve(__filename, → path[N].resolve(\"\","
  );
}
