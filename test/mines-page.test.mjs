// Run with: npm test
// Runs the Mines play page's script against a tiny stand-in for the browser, and checks what the screen reader live
// region says.
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

function openPage(html) {
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes("createState"));
  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id)) {
      const listeners = {};
      let text = "";
      elements.set(id, {
        writes: 0, listeners, dataset: {},
        get textContent() { return text; },
        set textContent(v) { text = v; this.writes++; },
        classList: { toggle() {} },
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
  let interval = null;
  vm.runInNewContext(script, {
    document: { getElementById: el, querySelectorAll: (q) => (q === "[data-diff]" ? [easy] : []) },
    Math,
    setInterval: (fn) => { interval = fn; },
  });
  const click = (x, y, button = 0) => board.listeners.mouseup({ button, clientX: x * CELL + 1, clientY: y * CELL + 1 });
  return { el, click, interval: () => interval(), live: el("live"), easy: () => easy.listeners.click() };
}

for (const [name, read] of Object.entries(pages)) {
  test(`${name}: the board is an image with a label and the live region is polite`, () => {
    const html = read();
    assert.match(html, /<canvas id="board"[^>]* role="img" aria-label="Mines board"/);
    assert.match(html, /<p id="live" class="sr-only" aria-live="polite" aria-atomic="true"><\/p>/);
  });

  test(`${name}: flags and the end of a game are announced, the timer alone is not`, () => {
    const page = openPage(read());
    page.easy();
    page.click(15, 10);
    assert.equal(page.live.textContent, "Game on :), 0 flags");
    const hidden = [];
    for (let y = 0; y < 20; y++) for (let x = 0; x < 30; x++) hidden.push([x, y]);
    const [fx, fy] = hidden.find(([x, y]) => { page.click(x, y, 2); return page.live.textContent.endsWith(", 1 flags"); });
    assert.equal(page.live.textContent, "Game on :), 1 flags");
    const writes = page.live.writes;
    for (let i = 0; i < 30; i++) page.interval();
    assert.equal(page.el("hud-time").textContent, "3s");
    assert.equal(page.live.writes, writes);
    page.click(fx, fy, 2);
    assert.equal(page.live.textContent, "Game on :), 0 flags");
    for (const [x, y] of hidden) if (!/^(You won|Game over)/.test(page.live.textContent)) page.click(x, y);
    assert.match(page.live.textContent, /^(You won! :D|Game over :\(), 0 flags$/);
  });
}
