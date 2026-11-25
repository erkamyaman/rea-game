// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scaffold } from "../lib/scaffold.mjs";

// An empty repo root, like makeRoot in test/verify.test.mjs.
function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rea-games-scaffold-"));
}

test("rejects names that are not lowercase letters, digits and dashes", () => {
  const root = makeRoot();
  try {
    for (const name of ["My Game", "-x"]) {
      assert.throws(() => scaffold(root, name), /lowercase letters, digits and dashes/, name);
    }
    assert.ok(!fs.existsSync(path.join(root, "games")), "a rejected name writes nothing");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("refuses a game folder that already exists", () => {
  const root = makeRoot();
  try {
    scaffold(root, "demo");
    assert.throws(() => scaffold(root, "demo"), /games\/demo already exists/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("writes a game.json whose name and web port point at files that exist", () => {
  const root = makeRoot();
  try {
    const dir = scaffold(root, "demo");
    assert.equal(dir, path.join(root, "games", "demo"));

    const meta = JSON.parse(fs.readFileSync(path.join(dir, "game.json"), "utf8"));
    assert.equal(meta.name, "demo");

    const web = meta.ports.web;
    assert.equal(web.cmd[0], "node");
    assert.ok(fs.existsSync(path.join(dir, web.cmd[1])), `${web.cmd[1]} exists`);
    assert.ok(fs.existsSync(path.join(dir, web.play)), `${web.play} exists`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
