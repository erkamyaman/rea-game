// Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
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
