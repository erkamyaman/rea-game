// Run with: npm test
// Runs the Dino play page's script against a minimal browser stand-in and checks the polite live region.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { bundleHtml } from "../scripts/bundle.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "games/dino/ports/web/index.html");
const pages = {
  "games/dino/ports/web/index.html": () => bundleHtml(fs.readFileSync(source, "utf8"), source),
  "docs/play/dino.html": () => fs.readFileSync(path.join(root, "docs/play/dino.html"), "utf8"),
};

function openPage(html) {
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes("new Dino"));
  const ctx2d = new Proxy({}, { get: () => () => {} });
  const elements = new Map();
  let liveWrites = 0;
  const el = (id) => {
    if (!elements.has(id)) {
      let text = "";
      elements.set(id, {
        style: {},
        getBoundingClientRect: () => ({ width: 600 }),
        addEventListener() {},
        get textContent() { return text; },
        set textContent(v) { liveWrites += id === "live" ? 1 : 0; text = v; },
      });
    }
    return elements.get(id);
  };
  el("c").getContext = () => ctx2d;
  const listeners = {};
  let frame = null, now = 0;
  const addListener = (type, fn) => { (listeners[type] ??= []).push(fn); };
  const document = {
    getElementById: el,
    documentElement: {},
    addEventListener: addListener,
  };
  const window = { devicePixelRatio: 1, addEventListener: addListener };
  vm.runInNewContext(script, {
    document,
    window,
    Math,
    Number,
    String,
    Array,
    Object,
    localStorage: { getItem: () => null, setItem() {} },
    getComputedStyle: () => ({}),
    performance: { now: () => now },
    requestAnimationFrame: (fn) => { frame = fn; },
    addEventListener: addListener,
  });
  const tick = (ms = 1000 / 60) => { now += ms; frame(now); };
  const press = (code) => {
    const e = { code, preventDefault() {} };
    for (const fn of listeners.keydown ?? []) fn(e);
    tick();
    for (const fn of listeners.keyup ?? []) fn(e);
    tick();
  };
  tick();
  return {
    tick,
    press,
    live: () => el("live").textContent,
    writes: () => liveWrites,
  };
}

for (const [name, read] of Object.entries(pages)) {
  test(`${name}: has a polite live region`, () => {
    const html = read();
    assert.match(html, /id="live"[^>]*aria-live="polite"/);
  });

  test(`${name}: announces running once, then announces crash with score and best`, () => {
    const page = openPage(read());
    assert.equal(page.live(), "");
    page.press("Space");
    assert.equal(page.live(), "Running");
    const writesAfterStart = page.writes();
    for (let i = 0; i < 60 * 30 && !/^Game over/.test(page.live()); i++) page.tick();
    assert.match(page.live(), /^Game over, \d+ points, best \d+$/);
    assert.equal(page.writes(), writesAfterStart + 1);
    page.press("Enter");
    assert.equal(page.live(), "Running");
  });
}
