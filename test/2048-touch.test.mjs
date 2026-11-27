import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { bundleHtml } from "../scripts/bundle.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "games/2048/ports/web/index.html");
const pages = {
  source: () => bundleHtml(fs.readFileSync(source, "utf8"), source),
  published: () => fs.readFileSync(path.join(root, "docs/play/2048.html"), "utf8"),
};

function openPage(html) {
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes("new Game2048"));
  const elements = new Map();
  function element() {
    const listeners = {};
    return { listeners, style: {}, classList: { toggle() {} }, append() {}, focus() {},
      addEventListener(type, fn) { (listeners[type] ??= []).push(fn); } };
  }
  const el = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const document = Object.assign(element(), { getElementById: el, createElement: element });
  const window = {};
  vm.runInNewContext(script, { document, window, addEventListener() {},
    score: el("score"), best: el("best"), msgtitle: el("msgtitle"), keep: el("keep"),
    restart: el("restart"), again: el("again") });
  const moves = [];
  window.__game.move = direction => moves.push(direction);
  function fire(target, type, touches, changedTouches) {
    const e = { touches, changedTouches };
    for (const fn of el(target).listeners[type] ?? []) fn(e);
    for (const fn of document.listeners[type] ?? []) fn(e);
  }
  return { fire, moves };
}

for (const [name, read] of Object.entries(pages)) {
  test(`${name}: swipe with one contact moves left; outside contact cancels swipe`, () => {
    const { fire, moves } = openPage(read());
    const start = { identifier: 1, clientX: 200, clientY: 300 };
    const end = { ...start, clientX: 140 };
    const outside = { identifier: 2, clientX: 195, clientY: 40 };
    fire("board", "touchstart", [start], [start]);
    fire("board", "touchend", [], [end]);
    assert.deepEqual(moves, [3]);
    fire("board", "touchstart", [start], [start]);
    fire("header", "touchstart", [start, outside], [outside]);
    fire("board", "touchend", [outside], [end]);
    fire("header", "touchend", [], [outside]);
    assert.deepEqual(moves, [3]);
  });
}
