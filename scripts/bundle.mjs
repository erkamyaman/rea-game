// Turns each game's playable port into ONE html file (docs/play/<game>.html) that works from file:// and GitHub Pages.
// Module imports are inlined, `export` is dropped. Only relative "./x.mjs" imports are supported, and only
// `export const|let|var|function|class` and local `export { … }` lists: any other export stops the bundle.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { listGames, loadGame } from "../lib/verify.mjs";
import { EXPORT_DECL, EXPORT_LIST, exportedNames } from "./exported-names.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const modules = new Map();
// Leading spaces or tabs are allowed: a page often indents the code inside its <script>.
const IMPORT = /^([ \t]*)import\s*\{([^}]*)\}\s*from\s*["'](\.\/[^"']+)["'];?\s*$/gm;
// Any import left after inlining would make the plain <script> fail to parse in the browser.
const LEFTOVER_IMPORT = /^[ \t]*import(?=[\s{*"'])[^\n]*/m;
// An export left after inlining has no binding to hand back (`export default`, `export *`, `export { … } from`).
// An export after a `;` on the same line (`const A = 1; export { A };`) is never stripped either; the
// part before that `;` must hold no `//`, so the word in a line comment does not count.
const LEFTOVER_EXPORT = /^[ \t]*export\b[^\n]*|^(?:(?!\/\/)[^\n])*?;[ \t]*export\b[^\n]*/m;
// String literals are blanked (same length, quotes kept) before that check, so `"; export"` in a string is not code.
const STRING = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g;
function leftoverExport(body) {
  const blank = body.replace(STRING, (m) => m[0] + m.slice(1, -1).replace(/[^\n]/g, " ") + m.at(-1));
  const at = blank.match(LEFTOVER_EXPORT)?.index;
  if (at === undefined) return undefined;
  const start = body.lastIndexOf("\n", at) + 1;
  const end = body.indexOf("\n", at);
  return body.slice(start, end === -1 ? undefined : end);
}
// Each module runs in its own function scope and hands back its named exports, so two files may
// both declare the same top-level name (the page and its logic module often both define W and H).
function inline(dir, file, out) {
  const full = path.join(dir, file);
  if (modules.has(full)) return modules.get(full);
  const id = `__mod${modules.size}`;
  modules.set(full, id);
  const src = fs.readFileSync(full, "utf8");
  const names = exportedNames(src);
  const body = imports(src, path.dirname(full), out).replace(EXPORT_LIST, "").replace(EXPORT_DECL, "");
  const left = leftoverExport(body);
  if (left) throw new Error(`${path.relative(root, full)}: export not supported by the bundler: ${left.trim()}`);
  out.push(`const ${id} = (() => {\n${body}\nreturn { ${names.join(", ")} };\n})();\n`);
  return id;
}
function imports(src, dir, out) {
  return src.replace(IMPORT, (_, indent, list, rel) => {
    const id = inline(dir, rel, out);
    const binds = list.split(",").map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/\s+as\s+/, ": "));
    return `${indent}const { ${binds.join(", ")} } = ${id};`;
  });
}
// One page's html with its module script turned into a plain <script> holding every inlined module.
export function bundleHtml(html, htmlPath) {
  try {
    return html.replace(/<script type="module">([\s\S]*?)<\/script>/, (_, body) => {
      const mods = [];
      const rest = imports(body, path.dirname(htmlPath), mods);
      return `<script>\n(() => {\n${mods.join("")}${rest}\n})();\n</script>`;
    });
  } finally {
    modules.clear();
  }
}

export function leftoverImport(html) {
  return html.match(LEFTOVER_IMPORT)?.[0];
}

function main() {
  fs.mkdirSync(path.join(root, "docs/play"), { recursive: true });
  let failed = false;
  for (const g of listGames(root)) {
    const { dir, meta } = loadGame(root, g);
    const play = Object.values(meta.ports).find((p) => p.play)?.play;
    if (!play) continue;
    const htmlPath = path.join(dir, play);
    const page = "docs/play/" + g + ".html";
    let out;
    try {
      out = bundleHtml(fs.readFileSync(htmlPath, "utf8"), htmlPath);
    } catch (e) {
      console.error(`${page}: ${e.message}`);
      failed = true;
      continue;
    }
    fs.writeFileSync(path.join(root, page), out);
    const left = leftoverImport(out);
    if (left) {
      console.error(`${page}: import not inlined, the page will not load: ${left.trim()}`);
      failed = true;
      continue;
    }
    console.log("wrote " + page, out.length, "bytes");
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
