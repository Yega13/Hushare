import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const handlerPath = resolve(".open-next/server-functions/default/handler.mjs");

let content;
try {
  content = readFileSync(handlerPath, "utf-8");
} catch {
  console.error("[patch-worker] handler.mjs not found at " + handlerPath);
  process.exit(1);
}

// ── 1. Detect whether requireChunk has switch cases ───────────────────────────
const hasAnyCases = content.includes('case "server/chunks/');
if (hasAnyCases) {
  const caseCount = (content.match(/case "server\/chunks\//g) || []).length;
  console.log("[patch-worker] requireChunk already has " + caseCount + " case(s). ✓");
} else {
  // ── 2. FALLBACK: add ESM import declarations and rebuild requireChunk ─────────
  //    We do NOT inline chunk source — instead we add static import declarations
  //    so that wrangler's own esbuild bundles the CJS chunk files correctly.
  //    (CJS default-export = module.exports = the turbopack chunk array.)
  console.warn("[patch-worker] requireChunk has NO cases — rebuilding via ESM imports.");

  const chunksBase = resolve(".open-next/server-functions/default/.next/server/chunks");
  if (!existsSync(chunksBase)) {
    console.error("[patch-worker] chunks dir not found: " + chunksBase);
    process.exit(1);
  }

  // Recursively collect all chunk .js files (excluding turbopack runtime files)
  function collectChunks(dir, result) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        collectChunks(full, result);
      } else if (entry.endsWith(".js") && entry !== "[turbopack]_runtime.js") {
        result.push(full);
      }
    }
    return result;
  }
  const chunkFiles = collectChunks(chunksBase, []);
  console.log("[patch-worker] Found " + chunkFiles.length + " chunk(s) to import.");

  // handler.mjs lives in .open-next/server-functions/default/
  const handlerDir = resolve(".open-next/server-functions/default");

  const importLines = [];
  const switchCases = [];
  chunkFiles.forEach((absPath, i) => {
    // Relative path from handler.mjs directory to the chunk (always forward-slashes)
    const rel = "./" + relative(handlerDir, absPath).split("\\").join("/");
    // Case key = path relative to .next/ (what loadRuntimeChunkPath passes)
    const key = absPath.split(/[/\\]/).join("/").replace(/.*\/\.next\//, "");
    const varName = "__hush_chunk_" + i;
    importLines.push("import " + varName + " from " + JSON.stringify(rel) + ";");
    switchCases.push("    case " + JSON.stringify(key) + ": return " + varName + ";");
  });

  const newRequireChunk =
    "function requireChunk(chunkPath) {\n" +
    "  switch(chunkPath) {\n" +
    switchCases.join("\n") + "\n" +
    "    default:\n" +
    '      console.error("[requireChunk] MISS:", chunkPath);\n' +
    "      throw new Error(`Not found ${chunkPath}`);\n" +
    "  }\n" +
    "}";

  // Insert import declarations after the very first line of handler.mjs
  // (which is the node:timers banner import added by bundle-server.js).
  const firstNewline = content.indexOf("\n");
  if (firstNewline === -1) {
    console.error("[patch-worker] handler.mjs has no newlines — unexpected format.");
    process.exit(1);
  }
  content =
    content.slice(0, firstNewline + 1) +
    importLines.join("\n") + "\n" +
    content.slice(firstNewline + 1);
  console.log("[patch-worker] Inserted " + importLines.length + " import declarations.");

  // Replace empty requireChunk functions. The empty minified form is exactly:
  //   function requireChunk(chunkPath){throw new Error(`Not found ${chunkPath}`)}
  // We match the exact pattern (not [^}]* which would stop at } in ${chunkPath}).
  let replaced = 0;
  // Template-literal form (minifySyntax:false or esbuild keeps template literals)
  content = content.replace(
    /function requireChunk\(chunkPath\)\{throw new Error\(`Not found \$\{chunkPath\}`\)\}/g,
    () => { replaced++; return newRequireChunk; }
  );
  if (replaced === 0) {
    // String-concatenation form (minifySyntax:true may convert template → concat)
    content = content.replace(
      /function requireChunk\(chunkPath\)\{throw new Error\("Not found "\+chunkPath\)\}/g,
      () => { replaced++; return newRequireChunk; }
    );
  }
  console.log("[patch-worker] Replaced " + replaced + " empty requireChunk function(s).");
}

// ── 3. Add miss-logging before every requireChunk "Not found" default throw ───
const missPattern = /throw new Error\(`Not found \$\{chunkPath\}`\)/g;
const missBefore = content;
content = content.replace(
  missPattern,
  'console.error("[requireChunk] MISS:", chunkPath); throw new Error(`Not found ${chunkPath}`)'
);
const missCount = (missBefore.match(missPattern) || []).length;
if (missCount > 0) {
  console.log("[patch-worker] Injected miss-logging in " + missCount + " requireChunk default case(s).");
}

// ── 4. Redundant __filename fix (harmless; init.js already sets it to "") ─────
const fnPattern = /(\bpath\w*)\.resolve\(__filename,/g;
const fnBefore = content;
content = content.replace(fnPattern, '$1.resolve("",');
const fnCount = (fnBefore.match(fnPattern) || []).length;
if (fnCount > 0) {
  console.log("[patch-worker] Patched " + fnCount + " path.resolve(__filename, occurrence(s).");
}

writeFileSync(handlerPath, content);
console.log("[patch-worker] Done.");
