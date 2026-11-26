// Run with: npm test
// Runs the Paddles play page's script against a tiny stand-in for the browser, and checks what the menu title and
// the screen reader live region say.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { bundleHtml } from "../scripts/bundle.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "games/paddles/ports/web/index.html");
const pages = {
  "games/paddles/ports/web/index.html": () => bundleHtml(fs.readFileSync(source, "utf8"), source),
  "docs/play/paddles.html": () => fs.readFileSync(path.join(root, "docs/play/paddles.html"), "utf8"),
};

function openPage(html, { confirm = true } = {}) {
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes("new Paddles"));
  const ctx2d = new Proxy({}, { get: () => () => {} });
  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id)) elements.set(id, { textContent: "", style: {}, classList: { toggle() {} }, addEventListener() {} });
    return elements.get(id);
  };
  el("c").getContext = () => ctx2d;
  el("c").width = 640; el("c").height = 480;
  const listeners = {};
  let frame = null, now = 0;
  const document = {
    getElementById: el,
    querySelectorAll: () => [],
    documentElement: { dataset: {} },
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
  };
  const window = { devicePixelRatio: 1, confirm: () => confirm, addEventListener() {} };
  vm.runInNewContext(script, {
    document, window, Math,
    performance: { now: () => now },
    requestAnimationFrame: (fn) => { frame = fn; },
  });
  const tick = (ms = 16) => { now += ms; frame(now); };
  const key = (k) => {
    const e = { key: k, repeat: false, preventDefault() {} };
    for (const fn of listeners.keydown) fn(e);
    for (const fn of listeners.keyup) fn(e);
    tick();
  };
  tick();
  return { key, tick, title: () => el("msgtitle").textContent, live: () => el("live").textContent };
}

for (const [name, read] of Object.entries(pages)) {
  test(`${name}: giving a game up with Esc says the game ended, with the score`, () => {
    const page = openPage(read());
    assert.equal(page.title(), "Paddles");
    page.key("0");
    assert.equal(page.live(), "Left 0, Right 0");
    page.key("Escape");
    assert.equal(page.title(), "Game ended");
    assert.equal(page.live(), "Game ended, Left 0, Right 0");
    // a new game goes back to the running score
    page.key("0");
    assert.equal(page.live(), "Left 0, Right 0");
  });

  test(`${name}: saying no to "Give up this game?" keeps the game going`, () => {
    const page = openPage(read(), { confirm: false });
    page.key("0");
    page.key("Escape");
    assert.equal(page.live(), "Left 0, Right 0");
  });

  test(`${name}: a won game still names the winner`, () => {
    const page = openPage(read());
    page.key("0");
    // two computer paddles play it out; 9 points take well under ten minutes of game time
    for (let i = 0; i < 60 * 600 && !/wins/.test(page.live()); i++) page.tick();
    assert.match(page.title(), /^(Left|Right) wins 9 to \d$/);
    assert.equal(page.live(), page.title());
  });
}
