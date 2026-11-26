// Names a module exports with `export const|let|var|function|class` or a local `export { a, b as c }` list,
// for scripts/bundle.mjs. A renamed export is given as `c: b`, ready for the bundler's `return { … }`.
// A declaration may bind several names (`export const W = 10, H = 20;`): every binding is kept.
// A comma only separates bindings at depth zero, not inside a string, a comment, (), [] or {}.
// Any other export (`export default`, `export *`, `export { … } from`) is left for the bundler to refuse.
// A local export list, possibly over several lines; a list followed by `from` re-exports and is not matched.
export const EXPORT_LIST = /^export\s*\{([^}]*)\}(?!\s*from\b)[ \t]*;?[ \t]*$/gm;
// The `export` word before a declaration exportedNames understands.
export const EXPORT_DECL = /^export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm;
const DECL = /^export\s+(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/gm;
const VARS = /^export\s+(?:const|let|var)\s+/gm;
const NAME = /^[A-Za-z_$][\w$]*/;
const CONTINUES = /[,=+\-*/%?:|&!<>(\[{.]$/;
// A value also goes on when the next line starts with a binary operator (`!=`, `in` and `instanceof` included),
// `.`, `,`, `?` or `:` (`export const A = 1\n  + 10, B = 2`). Blank and comment lines before it are skipped, as
// JavaScript does. `++` / `--` there starts something new, so the declaration ends. A name with no `=` yet only
// goes on with `=` or `,`: `export let A\n/re/.test(s)` is two statements.
const CONTINUES_NEXT = /^(?:(?!\+\+|--)[-+*/%=<>&|^?:.,]|!=|in(?:stanceof)?(?![\w$]))/;
const CONTINUES_NAME = /^(?:=(?![=>])|,)/;
const SKIP = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/;

export function exportedNames(src) {
  const found = [];
  for (const m of src.matchAll(DECL)) found.push([m.index, m[1]]);
  for (const m of src.matchAll(VARS)) {
    for (const [at, name] of bindings(src, m.index + m[0].length)) found.push([at, name]);
  }
  for (const m of src.matchAll(EXPORT_LIST)) {
    for (const item of m[1].replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, " ").split(",").map((x) => x.trim()).filter(Boolean)) {
      const [local, , exported = local] = item.split(/\s+(as)\s+/);
      found.push([m.index, exported === local ? local : `${exported}: ${local}`]);
    }
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, name]) => name);
}

function bindings(src, i) {
  const out = [];
  let expectName = true;
  let depth = 0;
  let last = "";
  let value = false;
  while (i < src.length) {
    if (expectName) {
      while (/\s/.test(src[i])) i++;
      const name = NAME.exec(src.slice(i));
      if (!name) throw new Error(`exported-names: unsupported export at offset ${i} (destructuring?)`);
      out.push([i, name[0]]);
      i += name[0].length;
      last = name[0].at(-1);
      expectName = false;
      value = false;
      continue;
    }
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { const end = src.indexOf("*/", i + 2); i = end < 0 ? src.length : end + 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      i++; last = c; continue;
    }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth === 0 && c === ",") { expectName = true; i++; continue; }
    else if (depth === 0 && c === ";") break;
    else if (depth === 0 && c === "=") value = true;
    else if (depth === 0 && c === "\n" && !CONTINUES.test(last) && !(value ? CONTINUES_NEXT : CONTINUES_NAME).test(src.slice(i + 1).replace(SKIP, ""))) break;
    if (!/\s/.test(c)) last = c;
    i++;
  }
  return out;
}
