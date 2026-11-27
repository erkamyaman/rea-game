import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "rea-games.mjs");
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

test("an unknown command is named on the first line of stderr and exits 2", () => {
  const r = run("frobnicate");
  assert.equal(r.status, 2);
  assert.equal(r.stderr.split("\n")[0], 'rea-games: unknown command "frobnicate"');
  assert.match(r.stderr, /rea-games verify <game\|all>/);
});

test("--version and -v print the version from package.json", () => {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  for (const flag of ["--version", "-v"]) {
    const r = run(flag);
    assert.equal(r.status, 0, flag);
    assert.equal(r.stdout, `${version}\n`, flag);
  }
});

test("--help mentions --version", () => {
  const r = run("--help");
  assert.equal(r.status, 0);
  const lines = r.stdout.split("\n");
  const column = (start) => { const l = lines.find((x) => x.startsWith(start)); assert.ok(l, start); return start.length + l.slice(start.length).search(/\S/); };
  const col = column("  rea-games list");
  assert.equal(column("  rea-games --version, -v"), col);
  assert.equal(column("  rea-games --help, -h"), col);
  assert.match(r.stdout, /^  rea-games --version, -v +print the version from package\.json$/m);
  assert.match(r.stdout, /^  rea-games --help, -h +show this help, on its own or after any command$/m);
});

test("--help and -h after a command print the help and exit 0", () => {
  for (const args of [["-h"], ["verify", "--help"], ["verify", "--port", "web", "-h"], ["new", "--help"], ["record", "-h"]]) {
    const r = run(...args);
    assert.equal(r.status, 0, args.join(" "));
    assert.match(r.stdout, /^rea-games: reverse-engineer/, args.join(" "));
  }
});

test("new with no name prints its usage and exits 2", () => {
  const r = run("new");
  assert.equal(r.status, 2);
  assert.equal(r.stderr.trim(), "usage: rea-games new <game>   (lowercase letters, digits and dashes)");
});

test("new with an invalid name keeps the name-rule error and exits 1", () => {
  const r = run("new", "Bad_Name");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^game names are lowercase letters, digits and dashes$/m);
});
