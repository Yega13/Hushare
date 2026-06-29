import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const handlerPath = resolve(".open-next/server-functions/default/handler.mjs");

let content;
try {
  content = readFileSync(handlerPath, "utf-8");
} catch {
  console.error("[patch-worker] handler.mjs not found at " + handlerPath);
  process.exit(1);
}

// ── 1. Add miss-logging before every requireChunk "Not found" throw ──────────
//    Surfaces the actual failing chunkPath in Cloudflare logs / debug wrapper.
const missPattern = /throw new Error\(`Not found \$\{chunkPath\}`\)/g;
const missBefore = content;
content = content.replace(
  missPattern,
  'console.error("[requireChunk] MISS:", chunkPath); throw new Error(`Not found ${chunkPath}`)'
);
const missCount = (missBefore.match(missPattern) || []).length;
if (missCount > 0) {
  console.log("[patch-worker] Injected miss-logging in " + missCount + " requireChunk default case(s).");
} else {
  console.warn("[patch-worker] WARNING: requireChunk 'Not found' pattern not found — is the format different?");
}

// ── 2. Detect whether chunks were inlined ────────────────────────────────────
const hasAnyCases = content.includes('case "server/chunks/ssr/');
if (hasAnyCases) {
  const caseCount = (content.match(/case "server\/chunks\/ssr\//g) || []).length;
  console.log("[patch-worker] requireChunk already has " + caseCount + " case(s) — chunks are inlined by the build. ✓");
} else {
  // ── 3. FALLBACK: inline all chunks from the output directory ───────────────
  //    On Windows, getInlinableChunks() uses forward-slash filter that misses
  //    backslash paths, so requireChunk ends up empty.  We rebuild it here.
  console.warn("[patch-worker] requireChunk has NO cases — rebuilding it from output directory.");
  const chunksDir = resolve(".open-next/server-functions/default/.next/server/chunks/ssr");
  if (!existsSync(chunksDir)) {
    console.error("[patch-worker] chunks/ssr dir not found: " + chunksDir);
    process.exit(1);
  }
  const chunkFiles = readdirSync(chunksDir)
    .filter(f => f.endsWith(".js") && f !== "[turbopack]_runtime.js");
  console.log("[patch-worker] Inlining " + chunkFiles.length + " chunk(s).");

  // Build switch cases using string concatenation (safe if src has backticks/`${`).
  let casesStr = "";
  for (const name of chunkFiles) {
    const src = readFileSync(join(chunksDir, name), "utf-8");
    const key = JSON.stringify("server/chunks/ssr/" + name);
    casesStr +=
      "      case " + key + ": {\n" +
      "        const __m = { exports: {} };\n" +
      "        (function(module, exports) {\n" +
      src + "\n" +
      "        })(__m, __m.exports);\n" +
      "        return __m.exports;\n" +
      "      }\n";
  }

  const newFn =
    "function requireChunk(chunkPath) {\n" +
    "    switch(chunkPath) {\n" +
    casesStr +
    "      default:\n" +
    "        console.error(\"[requireChunk] MISS:\", chunkPath);\n" +
    '        throw new Error(`Not found ${chunkPath}`);\n' +
    "    }\n" +
    "  }";

  // Replace both empty requireChunk functions (SSR and non-SSR runtimes).
  // The empty pattern is: function requireChunk(chunkPath){ ... only default throw ... }
  // After step 1, the throw has a console.error prefix, so we must handle that variant too.
  let replaced = 0;
  content = content.replace(
    /function requireChunk\(chunkPath\) \{[\s\S]*?console\.error\("\[requireChunk\] MISS:",\s*chunkPath\);\s*throw new Error\(`Not found \$\{chunkPath\}`\);\s*\}/g,
    () => { replaced++; return newFn; }
  );
  if (replaced === 0) {
    // Fallback regex if whitespace differs
    content = content.replace(
      /function requireChunk\(chunkPath\)\{[\s\S]*?throw new Error\(`Not found \$\{chunkPath\}`\)\}/g,
      () => { replaced++; return newFn; }
    );
  }
  console.log("[patch-worker] Replaced " + replaced + " empty requireChunk function(s) with " + chunkFiles.length + " inlined chunks.");
}

// ── 4. Redundant __filename fix (harmless, init.js already sets it to "") ────
const fnPattern = /(\bpath\w*)\.resolve\(__filename,/g;
const fnBefore = content;
content = content.replace(fnPattern, '$1.resolve("",');
const fnCount = (fnBefore.match(fnPattern) || []).length;
if (fnCount > 0) {
  console.log("[patch-worker] Patched " + fnCount + " path.resolve(__filename, occurrence(s).");
}

writeFileSync(handlerPath, content);
console.log("[patch-worker] Done.");
