// Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { exportedNames } from "../scripts/exported-names.mjs";

test("every binding of a multi-name export is kept", () => {
  assert.deepEqual(exportedNames("export const W = 10, H = 20;\n"), ["W", "H"]);
  assert.deepEqual(
    exportedNames("export const START_STEP = 0.6, STEP_DECREMENT = 0.005, MIN_STEP = 0.1; // seconds per row\n"),
    ["START_STEP", "STEP_DECREMENT", "MIN_STEP"],
  );
});

test("commas inside calls, literals, strings and comments do not start a new binding", () => {
  assert.deepEqual(exportedNames("export const A = foo(1, 2), B = 3\n"), ["A", "B"]);
  assert.deepEqual(exportedNames("export const P = [1, 2], Q = { x: 1, y: 2 }, R = 'a, b', S = `c, ${d}`;\n"), ["P", "Q", "R", "S"]);
  assert.deepEqual(exportedNames("export const T = 1 /* , U */;\nexport let V = 2\n"), ["T", "V"]);
  assert.deepEqual(exportedNames("export const M = {\n  a: 1,\n  b: [2, 3],\n};\n"), ["M"]);
});

test("functions and classes are listed in source order", () => {
  assert.deepEqual(
    exportedNames("export const K = 1;\nexport function f(a, b) {}\nexport async function g() {}\nexport class C {}\n"),
    ["K", "f", "g", "C"],
  );
});

test("the Blocks logic exports H, STEP_DECREMENT and MIN_STEP", () => {
  const names = exportedNames(fs.readFileSync(new URL("../games/blocks/ports/web/blocks.mjs", import.meta.url), "utf8"));
  for (const n of ["W", "H", "KINDS", "SHAPES", "START_STEP", "STEP_DECREMENT", "MIN_STEP", "T0", "cellsOf", "Blocks"]) assert.ok(names.includes(n), n);
});

test("a local export list adds its names, a renamed one as `exported: local`", () => {
  assert.deepEqual(exportedNames("const B = 2, C = 3;\nexport { B, C };\n"), ["B", "C"]);
  assert.deepEqual(exportedNames("const B = 2;\nexport { B as D };\n"), ["D: B"]);
  assert.deepEqual(exportedNames("const A = 1, B = 2;\nexport {\n  B as D,\n  A\n};\n"), ["D: B", "A"]);
});

test("a list that re-exports from another module adds no name", () => {
  assert.deepEqual(exportedNames('export { A } from "./x.mjs";\n'), []);
  assert.deepEqual(exportedNames('export { A }\n  from "./x.mjs";\n'), []);
});

test("comments inside an export list are not part of a name", () => {
  assert.deepEqual(exportedNames("const B = 2;\nexport { B/* note */as D };\n"), ["D: B"]);
  assert.deepEqual(exportedNames("const A = 1, B = 2;\nexport {\n  A // first\n  , B\n};\n"), ["A", "B"]);
});

test("a value continued on a line that starts with an operator keeps the names after it (#80)", () => {
  assert.deepEqual(exportedNames("export const A = 1\n  + 10, B = 2;\n"), ["A", "B"]);
  assert.deepEqual(exportedNames("export const A = obj\n  .field, B = 2\n"), ["A", "B"]);
  assert.deepEqual(exportedNames("export const A = ok\n  ? 1\n  : 2, B = 3\n"), ["A", "B"]);
  assert.deepEqual(exportedNames("export const A = 1\n\n  , B = 2\n"), ["A", "B"]);
  assert.deepEqual(exportedNames("export const W = 640\n  // border\n  + 10, H = 480;\n"), ["W", "H"]);
  assert.deepEqual(exportedNames("export const W = 640\n  /* border */\n  + 10, H = 480;\n"), ["W", "H"]);
  assert.deepEqual(exportedNames("export const A = 1\n  !== 2, B = 3;\n"), ["A", "B"]);
  assert.deepEqual(exportedNames("export const A = x\n  instanceof Y, B = 3;\n"), ["A", "B"]);
  assert.deepEqual(exportedNames("export const A = \"k\"\n  in o, B = 3;\n"), ["A", "B"]);
  assert.deepEqual(exportedNames("export let A\n  = 5, B = 3;\n"), ["A", "B"]);
});

test("a next line that is a comment or starts with ++ / -- still ends the declaration", () => {
  assert.deepEqual(exportedNames("export const A = 1\n// the next one\nexport const C = 3;\n"), ["A", "C"]);
  assert.deepEqual(exportedNames("export const A = 1\n/* the next one */\nexport const C = 3;\n"), ["A", "C"]);
  assert.deepEqual(exportedNames("export let A = 1\n++count\nexport let D = 4\n"), ["A", "D"]);
  assert.deepEqual(exportedNames("export let A = 1\n--count\nexport let D = 4\n"), ["A", "D"]);
  assert.deepEqual(exportedNames("export const A = 1\nindex();\nexport const C = 3;\n"), ["A", "C"]);
  assert.deepEqual(exportedNames("export let A\n/foo,bar/.test(\"foo,bar\");\n"), ["A"]);
});
