// Post-processes the bundled Cloudflare Worker (handler.mjs) AFTER opennext's build.
//
// By this point `scripts/patch-opennext.mjs` has already fixed opennext so that
// `requireChunk` is populated with every Turbopack chunk (bundled by opennext's own
// node-platform esbuild). This script only does two small, runtime-critical things:
//
//   1. __filename fix — the Turbopack runtime computes
//        RUNTIME_ROOT = path.resolve(__filename, relativePathToRuntimeRoot)
//      but `__filename` is NOT defined in the worker bundle, so at runtime this
//      throws "Path must be a string". `requireChunk` uses the *relative* chunkPath
//      (RUNTIME_ROOT's value is discarded for chunk loading), so replacing the
//      undefined `__filename` with "" just keeps path.resolve from throwing.
//
//   2. miss-logging — surface the failing chunkPath if a chunk is ever missed
//      (cheap insurance; should not fire now that chunks are inlined).
//
// It also GUARDS the build: if requireChunk somehow ended up empty, it fails loudly
// instead of shipping a worker that 500s on every request.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const handlerPath = resolve(".open-next/server-functions/default/handler.mjs");

let content;
try {
  content = readFileSync(handlerPath, "utf-8");
} catch {
  console.error("[patch-worker] handler.mjs not found at " + handlerPath);
  process.exit(1);
}

// ── Guard: requireChunk must be populated (matches both minified `case"..."`
//    and pretty `case "..."` forms). ────────────────────────────────────────────
const caseCount = (content.match(/case\s*"server\/chunks\//g) || []).length;
if (caseCount === 0) {
  console.error(
    "[patch-worker] FATAL: requireChunk has NO chunk cases. The opennext chunk-inlining\n" +
    "patch (scripts/patch-opennext.mjs) did not take effect. Refusing to ship a worker\n" +
    "that would 500 on every request. Check that cf:build runs patch-opennext.mjs first."
  );
  process.exit(1);
}
console.log("[patch-worker] requireChunk has " + caseCount + " chunk case(s). ✓");

// ── 1. __filename fix (runtime-critical) ─────────────────────────────────────
const fnPattern = /(\bpath\w*)\.resolve\(__filename,/g;
const fnCount = (content.match(fnPattern) || []).length;
content = content.replace(fnPattern, '$1.resolve("",');
console.log("[patch-worker] Patched " + fnCount + " path.resolve(__filename, occurrence(s).");

// ── 2. miss-logging on the requireChunk default case (diagnostic) ────────────
const missPattern = /throw new Error\(`Not found \$\{chunkPath\}`\)/g;
const missCount = (content.match(missPattern) || []).length;
content = content.replace(
  missPattern,
  'console.error("[requireChunk] MISS:", chunkPath); throw new Error(`Not found ${chunkPath}`)'
);
if (missCount > 0) {
  console.log("[patch-worker] Injected miss-logging in " + missCount + " requireChunk default case(s).");
}

writeFileSync(handlerPath, content);
console.log("[patch-worker] Done.");
