import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadCases, packCases } from "../lib/verify.mjs";

// Every shipped game has packed cases, so both sides of pack/load need a test of their own.
function caseText(n) {
  return JSON.stringify({
    inputs: Array.from({ length: n }, (_, i) => i % 5),
    tape: Array.from({ length: n }, (_, i) => (i % 97) / 97),
    trace: Array.from({ length: n }, (_, i) => ({ score: i, cells: [0, 0, i] })),
  });
}

// games/<name> with game.json and the given plain cases; loadGame needs the game.json.
function makeGame(root, name, cases) {
  const dir = path.join(root, "games", name);
  const cd = path.join(dir, "cases");
  fs.mkdirSync(cd, { recursive: true });
  fs.writeFileSync(path.join(dir, "game.json"), JSON.stringify({ name, original: { repo: "test/test", license: "MIT" }, ports: {} }));
  for (const [file, raw] of Object.entries(cases)) fs.writeFileSync(path.join(cd, file), raw);
  return dir;
}

const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "rea-games-pack-"));

test("packCases leaves only .json.gz, reports fewer bytes, and loadCases returns the original cases", () => {
  const root = tempRoot();
  try {
    const a = caseText(200), b = caseText(250);
    const dir = makeGame(root, "packed", { "a.json": a, "b.json": b });
    const expected = loadCases(dir); // plain cases, before packing
    assert.deepEqual(expected.map((c) => c.file), ["a.json", "b.json"]);
    assert.deepEqual(expected.map((c) => c.raw), [a, b]);

    const { before, after } = packCases(root, "packed");
    assert.equal(before, Buffer.byteLength(a) + Buffer.byteLength(b));
    assert.ok(before > after, `before ${before} should be larger than after ${after}`);

    const cd = path.join(dir, "cases");
    assert.deepEqual(fs.readdirSync(cd).sort(), ["a.json.gz", "b.json.gz"]);
    assert.deepEqual(loadCases(dir), expected); // same names (without .gz) and same raw text
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("loadCases reads one packed case and one plain case", () => {
  const root = tempRoot();
  try {
    const a = caseText(150), b = caseText(160);
    const dir = makeGame(root, "mixed", { "a.json": a });
    packCases(root, "mixed"); // a.json becomes a.json.gz
    const cd = path.join(dir, "cases");
    fs.writeFileSync(path.join(cd, "b.json"), b); // a plain case alongside the packed one

    assert.deepEqual(fs.readdirSync(cd).sort(), ["a.json.gz", "b.json"]);
    assert.deepEqual(loadCases(dir), [
      { file: "a.json", raw: a },
      { file: "b.json", raw: b },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
