import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "rea-games.mjs");
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });

test("record with no game prints its usage and exits 2", () => {
  const r = run("record");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^usage: rea-games record <game>   \(games: 2048, [^)]+\)$/m);
});

test("an unknown game name gets a readable error, not ENOENT", () => {
  const r = run("verify", "nope");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^no game "nope" \(games: 2048, [^)]+\)\. Create one with: rea-games new nope$/m);
  assert.doesNotMatch(r.stderr, /ENOENT/);
});
