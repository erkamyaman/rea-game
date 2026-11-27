// Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleHtml, leftoverImport } from "../scripts/bundle.mjs";

const page = path.join(path.dirname(fileURLToPath(import.meta.url)), "../games/mines/ports/web/index.html");
const html = (indent) =>
  `<script type="module">\n${indent}import { COLS, ROWS } from "./mines.mjs";\n${indent}console.log(COLS, ROWS);\n</script>\n`;

test("an import at the start of a line is inlined", () => {
  const out = bundleHtml(html(""), page);
  assert.equal(leftoverImport(out), undefined);
  assert.match(out, /^const \{ COLS, ROWS \} = __mod0;$/m);
});

test("an import indented with spaces or tabs is inlined too", () => {
  for (const indent of ["    ", "\t", " \t "]) {
    const out = bundleHtml(html(indent), page);
    assert.equal(leftoverImport(out), undefined, JSON.stringify(indent));
    assert.match(out, /^[ \t]*const \{ COLS, ROWS \} = __mod0;$/m);
    assert.doesNotMatch(out, /<script type="module">/);
  }
});

test("an import the bundler cannot inline is reported", () => {
  const out = bundleHtml(`<script type="module">\n  import confetti from "https://cdn.example/confetti.mjs";\n</script>\n`, page);
  assert.match(leftoverImport(out), /import confetti from/);
  assert.match(leftoverImport(`<script>\n  import "./side-effect.mjs";\n</script>\n`), /import "\.\/side-effect\.mjs"/);
  assert.match(leftoverImport(`<script>\nimport {\n  A,\n  B\n} from "https://cdn.example/x.mjs";\n</script>\n`), /^import \{$/);
  assert.equal(leftoverImport(`<script>\nimport("./later.mjs").then(start);\n</script>\n`), undefined);
});

// A throwaway module next to a throwaway page, so the test does not depend on any game's port.
function bundleModule(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rea-bundle-"));
  fs.writeFileSync(path.join(dir, "x.mjs"), src);
  const htmlPath = path.join(dir, "index.html");
  return () => bundleHtml(`<script type="module">\nimport { A, D } from "./x.mjs";\n</script>\n`, htmlPath);
}

test("a local export list is removed from the body and its names are handed back", () => {
  const out = bundleModule("export const A = 1;\nconst B = 2;\nexport {\n  B as D\n};\n")();
  assert.match(out, /^return \{ A, D: B \};$/m);
  assert.doesNotMatch(out, /B as D/);
  assert.doesNotMatch(out, /^[ \t]*export\b/m);
});

test("an export the bundler cannot hand back stops the bundle with the module and the line", () => {
  for (const line of ['export { A } from "./y.mjs";', "export * from \"./y.mjs\";", "export default 1;", "  export const E = 4;"]) {
    assert.throws(bundleModule(`const A = 1, D = 2;\n${line}\n`), (e) => e.message.includes("x.mjs") && e.message.includes(line.trim()), line);
  }
  // An export after other code on the same line is refused too (#74), but not the word in a comment.
  for (const line of ["const B = 1; export { B };", "foo(); export const E = 2;", "/* note */ const B = 1; export { B };"]) {
    assert.throws(bundleModule(`export const A = 1, D = 2;\nfunction foo() {}\n${line}\n`), (e) => e.message.includes("x.mjs") && e.message.includes(line), line);
  }
  const commented = bundleModule("export const A = 1; // the bundler reads each export; export one name or many\nexport const D = 2;\n")();
  assert.match(commented, /^return \{ A, D \};$/m);
  // Nor inside a block comment, on one line or spread over several (#79).
  const block = bundleModule("/* step one; export the names below */\nexport const A = 1;\n/*\n * do this; export that\n * it's fine; export too\n */\nexport const D = 2; /* a; export b */\n")();
  assert.match(block, /^return \{ A, D \};$/m);
  // Nor inside a string literal.
  const quoted = bundleModule('export const A = "; export default 1";\nexport const D = `x; export { y }`;\n')();
  assert.match(quoted, /^return \{ A, D \};$/m);
  // A refused page must not leave its modules behind: the next page starts again at __mod0.
  assert.match(bundleHtml(html(""), page), /^const \{ COLS, ROWS \} = __mod0;$/m);
});
