// Patches @opennextjs/cloudflare's Turbopack chunk-inlining so that requireChunk
// is actually populated.
//
// WHY: For this app's Turbopack build, Next's NFT traces do NOT list the
// `.next/server/chunks/**` files, so opennext's `getInlinableChunks(tracedFiles)`
// returns an EMPTY set. The generated `requireChunk` then throws "Not found" for
// every chunk at runtime, which surfaces as `ComponentMod.handler is not a function`
// (HTTP 500 on every page).
//
// FIX: make `getInlinableChunks` fall back to scanning the real chunks directory
// (derived from the turbopack runtime file path) when the traced-files filter comes
// up empty. The chunks are then inlined via `require("<abs path>")` and bundled by
// opennext's OWN esbuild pass (platform: "node"), which correctly resolves their
// transitive deps (e.g. @aws-sdk/core/client, @opentelemetry/api). This makes
// handler.mjs self-contained so wrangler's (workerd-platform) esbuild never has to
// resolve those node-only subpaths.
//
// Runs in cf:build BEFORE `opennextjs-cloudflare build`. Idempotent.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(
  "node_modules/@opennextjs/cloudflare/dist/cli/build/patches/plugins/turbopack.js"
);

if (!existsSync(target)) {
  console.error("[patch-opennext] target not found: " + target);
  process.exit(1);
}

let src = readFileSync(target, "utf-8");

if (src.includes("runtimeFilePath")) {
  console.log("[patch-opennext] already patched. ✓");
  process.exit(0);
}

function replaceOnce(haystack, needle, replacement, label) {
  const count = haystack.split(needle).length - 1;
  if (count !== 1) {
    console.error(
      "[patch-opennext] expected exactly 1 occurrence of " + label + ", found " + count + ". Aborting."
    );
    process.exit(1);
  }
  return haystack.replace(needle, replacement);
}

// 1) Pass the runtime filePath into inlineChunksFn at the call site.
//    (Done before changing the function definition so the call-site string is unique.)
src = replaceOnce(
  src,
  "${inlineChunksFn(tracedFiles)}",
  "${inlineChunksFn(tracedFiles, filePath)}",
  "inlineChunksFn call site"
);

// 2) inlineChunksFn signature: accept runtimeFilePath and forward it.
src = replaceOnce(
  src,
  "function inlineChunksFn(tracedFiles) {",
  "function inlineChunksFn(tracedFiles, runtimeFilePath) {",
  "inlineChunksFn definition"
);
src = replaceOnce(
  src,
  "const chunks = getInlinableChunks(tracedFiles);",
  "const chunks = getInlinableChunks(tracedFiles, runtimeFilePath);",
  "getInlinableChunks call inside inlineChunksFn"
);

// 3) Replace getInlinableChunks with a version that scans the chunks dir when the
//    traced-files filter is empty. String.raw keeps the regex backslashes intact.
const OLD_GET =
  "function getInlinableChunks(tracedFiles) {\n" +
  "    const chunks = new Set();\n" +
  "    for (const file of tracedFiles) {\n" +
  "        if (file === \"[turbopack]_runtime.js\") {\n" +
  "            continue;\n" +
  "        }\n" +
  "        if (file.includes(\".next/server/chunks/\")) {\n" +
  "            chunks.add(file);\n" +
  "        }\n" +
  "    }\n" +
  "    return Array.from(chunks);\n" +
  "}";

const NEW_GET = String.raw`function getInlinableChunks(tracedFiles, runtimeFilePath) {
    const norm = (p) => String(p).split(/[\\/]/).join("/");
    const chunks = new Set();
    for (const file of tracedFiles) {
        if (file === "[turbopack]_runtime.js") {
            continue;
        }
        const n = norm(file);
        if (n.includes(".next/server/chunks/")) {
            chunks.add(n);
        }
    }
    // Fallback: NFT traces frequently omit Turbopack chunks, leaving requireChunk
    // empty (every chunk load then throws "Not found" at runtime). Scan the real
    // chunks directory derived from the runtime file path:
    //   .../.next/server/chunks/ssr/[turbopack]_runtime.js -> .../.next/server/chunks
    if (chunks.size === 0 && runtimeFilePath) {
        const runtimeNorm = norm(runtimeFilePath);
        const chunksDir = runtimeNorm.replace(/(\/\.next\/server\/chunks)\/.*$/, "$1");
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = dir + "/" + entry.name;
                if (entry.isDirectory()) {
                    walk(full);
                }
                else if (entry.name.endsWith(".js") && entry.name !== "[turbopack]_runtime.js") {
                    chunks.add(full);
                }
            }
        };
        if (chunksDir !== runtimeNorm && fs.existsSync(chunksDir)) {
            walk(chunksDir);
        }
    }
    return Array.from(chunks);
}`;

src = replaceOnce(src, OLD_GET, NEW_GET, "getInlinableChunks definition");

writeFileSync(target, src);
console.log("[patch-opennext] patched getInlinableChunks to scan chunks dir. ✓");
