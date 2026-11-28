// Run with: npm test
// Runs the Mines play page's script against a tiny stand-in for the browser, and checks that the Flag button lets a
// tap (which arrives as a left click) place and remove flags while mouse play stays the same.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { bundleHtml } from "../scripts/bundle.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "games/mines/ports/web/index.html");
const pages = {
  "games/mines/ports/web/index.html": () => bundleHtml(fs.readFileSync(source, "utf8"), source),
  "docs/play/mines.html": () => fs.readFileSync(path.join(root, "docs/play/mines.html"), "utf8"),
};
const CELL = 26;

function openPage(html, { startInFlagMode = false } = {}) {
  let tick;
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes("createState"));
  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id)) {
      const listeners = {}, attrs = {};
      elements.set(id, {
        listeners, attrs, dataset: {}, textContent: "",
        classList: { toggle() {} },
        setAttribute: (k, v) => { attrs[k] = v; },
        addEventListener: (type, fn) => { listeners[type] = fn; },
      });
    }
    return elements.get(id);
  };
  const board = el("board");
  board.getContext = () => new Proxy({}, { get: () => () => {} });
  board.getBoundingClientRect = () => ({ left: 0, top: 0, width: board.width, height: board.height });
  const easy = el("diff-easy");
  easy.dataset.diff = "easy";
  vm.runInNewContext(script, {
    document: { getElementById: el, querySelectorAll: (q) => (q === "[data-diff]" ? [easy] : []) },
    Math,
    setInterval(fn) { tick = fn; },
  });
  const click = (x, y, button = 0) => board.listeners.mouseup({ button, clientX: x * CELL + 1, clientY: y * CELL + 1 });
  easy.listeners.click();
  if (startInFlagMode) el("btn-flag").listeners.click();
  click(15, 10);
  // the first hidden tile in reading order, found by flagging with a right click and taking the flag back
  let hidden = null;
  for (let i = 0; i < 600 && !hidden; i++) {
    const at = [i % 30, Math.floor(i / 30)];
    click(...at, 2);
    if (el("hud-flags").textContent === "1") { hidden = at; click(...at, 2); }
  }
  return { el, click, hidden, tick, flags: () => el("hud-flags").textContent, flagButton: el("btn-flag") };
}

for (const [name, read] of Object.entries(pages)) {
  test(`${name}: Flag mode reveals the first tile on a fresh board and after Reset`, () => {
    const page = openPage(read(), { startInFlagMode: true });
    const checkClockStarted = () => {
      for (let i = 0; i < 20; i++) page.tick();
      assert.equal(page.el("hud-time").textContent, "2s");
    };
    checkClockStarted();
    page.click(...page.hidden);
    assert.equal(page.flags(), "1");
    page.click(...page.hidden);
    assert.equal(page.flags(), "0");

    page.el("btn-reset").listeners.click();
    assert.equal(page.el("hud-time").textContent, "0s");
    page.click(15, 10);
    checkClockStarted();
  });

  test(`${name}: with the Flag button on, a tap places and removes a flag`, () => {
    const page = openPage(read());
    assert.ok(page.hidden);
    assert.equal(page.flags(), "0");
    page.flagButton.listeners.click();
    assert.equal(page.flagButton.attrs["aria-pressed"], "true");
    page.click(...page.hidden);
    assert.equal(page.flags(), "1");
    page.click(...page.hidden);
    assert.equal(page.flags(), "0");
    page.flagButton.listeners.click();
    assert.equal(page.flagButton.attrs["aria-pressed"], "false");
  });

  test(`${name}: with the Flag button off, a right click still flags and a left click does not`, () => {
    const page = openPage(read());
    page.click(...page.hidden, 2);
    assert.equal(page.flags(), "1");
    page.click(...page.hidden, 2);
    assert.equal(page.flags(), "0");
    page.click(...page.hidden);
    assert.equal(page.flags(), "0");
  });
}
