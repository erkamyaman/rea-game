// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright, playwrightPlaces } from "../lib/playwright.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const drivers = fs.readdirSync(path.join(root, "games"))
  .map((g) => path.join("games", g, "driver.mjs"))
  .filter((f) => fs.existsSync(path.join(root, f)));

function installedHere() {
  try { loadPlaywright(); return true; } catch { return false; }
}

test("PLAYWRIGHT_PATH is one of the places searched", () => {
  assert.ok(playwrightPlaces({ PLAYWRIGHT_PATH: "/somewhere/playwright" }).includes("/somewhere/playwright"));
  assert.ok(!playwrightPlaces({}).includes(undefined));
});

test("loads a Playwright install outside the repository by its path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rea-games-playwright-"));
  try {
    const pw = path.join(dir, "playwright");
    fs.mkdirSync(pw);
    fs.writeFileSync(path.join(pw, "index.js"), "module.exports = { chromium: 'fake' };\n");
    assert.equal(loadPlaywright([path.join(dir, "missing"), pw]).chromium, "fake");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("says to set PLAYWRIGHT_PATH when no place has Playwright", () => {
  assert.throws(() => loadPlaywright([path.join(os.tmpdir(), "rea-games-no-playwright")]), /playwright not found; set PLAYWRIGHT_PATH/);
});

test("every browser driver loads Playwright through lib/playwright.mjs", () => {
  assert.ok(drivers.includes(path.join("games", "dino", "driver.mjs")));
  for (const f of drivers) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    assert.match(src, /from "\.\.\/\.\.\/lib\/playwright\.mjs"/, f);
    assert.doesNotMatch(src, /require\(\s*["']playwright["']\s*\)/, f);
  }
});

test("the Dino driver says to set PLAYWRIGHT_PATH when Playwright is missing", { skip: installedHere() && "Playwright is installed here" }, async () => {
  const { openOriginal } = await import("../games/dino/driver.mjs");
  await assert.rejects(openOriginal(), /playwright not found; set PLAYWRIGHT_PATH/);
});
