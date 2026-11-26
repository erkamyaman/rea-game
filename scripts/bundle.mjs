// Turns each game's playable port into ONE html file (docs/play/<game>.html) that works from file:// and GitHub Pages.
// Module imports are inlined, `export` is dropped. Only relative "./x.mjs" imports are supported.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { listGames, loadGame } from "../lib/verify.mjs";
import { exportedNames } from "./exported-names.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const modules = new Map();
// Leading spaces or tabs are allowed: a page often indents the code inside its <script>.
const IMPORT = /^([ \t]*)import\s*\{([^}]*)\}\s*from\s*["'](\.\/[^"']+)["'];?\s*$/gm;
// Any import left after inlining would make the plain <script> fail to parse in the browser.
const LEFTOVER_IMPORT = /^[ \t]*import(?=[\s{*"'])[^\n]*/m;
// Each module runs in its own function scope and hands back its named exports, so two files may
// both declare the same top-level name (the page and its logic module often both define W and H).
function inline(dir, file, out) {
  const full = path.join(dir, file);
  if (modules.has(full)) return modules.get(full);
  const id = `__mod${modules.size}`;
  modules.set(full, id);
  const src = fs.readFileSync(full, "utf8");
  const names = exportedNames(src);
  const body = imports(src, path.dirname(full), out).replace(/^export\s+/gm, "");
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
  const out = html.replace(/<script type="module">([\s\S]*?)<\/script>/, (_, body) => {
    const mods = [];
    const rest = imports(body, path.dirname(htmlPath), mods);
    return `<script>\n(() => {\n${mods.join("")}${rest}\n})();\n</script>`;
  });
  modules.clear();
  return out;
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
    const out = bundleHtml(fs.readFileSync(htmlPath, "utf8"), htmlPath);
    const page = "docs/play/" + g + ".html";
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
