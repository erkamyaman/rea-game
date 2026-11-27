// Run with: npm test
// Every play page links back to the landing page and to the repository, and Enter on that link is left to the link
// on the pages whose game also listens for Enter.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { bundleHtml } from "../scripts/bundle.mjs";
import { listGames, loadGame } from "../lib/verify.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function pagesOf(game) {
  const { dir, meta } = loadGame(root, game);
  const source = path.join(dir, meta.ports.web.play);
  return {
    [path.relative(root, source)]: () => bundleHtml(fs.readFileSync(source, "utf8"), source),
    [`docs/play/${game}.html`]: () => fs.readFileSync(path.join(root, "docs/play", `${game}.html`), "utf8"),
  };
}

// The element each page plays in (the one its pointer and touch listeners are on, or that holds them).
const area = { "2048": "board", blocks: "court", bricks: "court", "canvas-bird": "wrap", dino: "wrap", mines: "start-screen", paddles: "court" };
const played = listGames(root).filter((g) => loadGame(root, g).meta.ports.web?.play);

test("every game with a play page is checked", () => {
  assert.deepEqual(played, Object.keys(area));
});

for (const game of played) {
  for (const [name, read] of Object.entries(pagesOf(game))) {
    test(`${name}: links to all games and to the repository, above the game`, () => {
      const html = read();
      const navs = [...html.matchAll(/<nav class="site"[^>]*>([\s\S]*?)<\/nav>/g)];
      assert.equal(navs.length, 1);
      const links = [...navs[0][1].matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
      assert.deepEqual(links, [["../index.html", "&larr; All games"], ["https://github.com/erkamyaman/rea-games", "rea-games on GitHub"]]);
      assert.ok(html.indexOf(`id="${area[game]}"`) > navs[0].index, "the links come before the game");
      assert.match(html, /nav\.site a:focus-visible \{ ?outline: ?2px solid/);
    });
  }
}

// Runs a page's game script against a stand-in for the browser that answers anything, and returns its key listeners.
function keyListeners(html, marker) {
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes(marker));
  const any = new Proxy(function () {}, {
    get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : k === Symbol.iterator ? function* () {} : any),
    set: () => true,
    apply: () => any,
    construct: () => any,
  });
  const listeners = { keydown: [], keyup: [] };
  const listen = (type, fn) => listeners[type]?.push(fn);
  const document = { getElementById: () => any, querySelectorAll: () => [], documentElement: { dataset: {} }, addEventListener: listen };
  const window = { devicePixelRatio: 1, confirm: () => false, addEventListener: listen };
  vm.runInNewContext(script, {
    document, window, addEventListener: listen, localStorage: any,
    performance: { now: () => 0 }, requestAnimationFrame: () => {},
  });
  return (type, key, code, tagName) => {
    let prevented = false;
    const e = { key, code, repeat: false, target: { tagName }, preventDefault: () => { prevented = true; } };
    for (const fn of listeners[type]) fn(e);
    return prevented;
  };
}

for (const [game, marker] of [["canvas-bird", "createBird"], ["bricks", "new Bricks"]]) {
  for (const [name, read] of Object.entries(pagesOf(game))) {
    test(`${name}: Enter on the focused link follows the link, Enter elsewhere still plays`, () => {
      const press = keyListeners(read(), marker);
      assert.equal(press("keydown", "Enter", "Enter", "A"), false);
      assert.equal(press("keydown", "Enter", "Enter", "BODY"), true);
    });
  }
}
