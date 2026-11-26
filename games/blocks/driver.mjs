// Runs the ORIGINAL "blocks" page (originals/blocks, MIT, vendored unmodified) in headless Chrome and
// reads its state from the live page globals. Only its inputs are replaced: a fake clock (Date.now,
// performance.now, requestAnimationFrame, cancelAnimationFrame) and a seeded Math.random whose every value
// goes to a tape. The page's own stats widget (stats.js) and CSS texture are left alone: they only draw
// into their own elements and never touch the game's variables.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPlaywright } from "../../lib/playwright.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ORIGINAL = path.join(here, "../../originals/blocks/index.html");
export const T0 = 1000000; // the fake clock's start, in ms (the port uses the same)
export const KEYCODES = { esc: 27, space: 32, left: 37, up: 38, right: 39, down: 40 };

// runs in the page before any of its scripts
function install({ seed, T0, KEYCODES }) {
  let t = T0;
  const queue = [];
  const tape = [];
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    const v = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    tape.push(v);
    return v;
  };
  // the page reads the time with `new Date().getTime()`, so the Date constructor is replaced as well
  const RealDate = Date;
  const FakeDate = function (...args) { return args.length ? new RealDate(...args) : new RealDate(Math.floor(t)); };
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => Math.floor(t);
  FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;
  window.Date = FakeDate;
  performance.now = () => t - T0;
  window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = () => {};
  const letter = (type) => (type ? "ijlostz"["ijlostz".split("").findIndex((l) => window[l] === type)] : null);
  const piece = (p) => (p ? { type: letter(p.type), x: p.x, y: p.y, dir: p.dir } : null);
  window.__blocks = {
    // the state read from the page's globals (declared with var at the top level of its script)
    state() {
      const rows = [];
      for (let y = 0; y < ny; y++) {
        let r = "";
        for (let x = 0; x < nx; x++) r += (blocks[x] && blocks[x][y] ? letter(blocks[x][y]) : ".");
        rows.push(r);
      }
      return {
        grid: rows,
        current: piece(current),
        next: piece(next),
        bag: pieces.map(letter).join(""),
        score, vscore, rows: window.rows, step, dt: window.dt,
        playing: !!playing,
        actions: actions.slice(),
      };
    },
    // one rendered frame: key events first (in order), then the clock moves and the animation callbacks run
    step(dtMs, keys) {
      for (const k of keys) {
        // the start link's href is `javascript:play();`; following a link runs that in a later task, so the
        // driver calls the same function directly to keep it inside this frame
        if (k === "play") { window.play(); continue; }
        const ev = new KeyboardEvent("keydown", { keyCode: KEYCODES[k], bubbles: true, cancelable: true });
        document.dispatchEvent(ev);
      }
      t += dtMs;
      const cbs = queue.splice(0);
      for (const cb of cbs) cb(t);
    },
    tape: () => tape.slice(),
  };
}

export async function openOriginal({ seed = 1, headless = true } = {}) {
  const { chromium } = loadPlaywright();
  let browser;
  try { browser = await chromium.launch({ headless }); }
  catch { browser = await chromium.launch({ headless, channel: "chrome" }); }
  const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
  await page.addInitScript(install, { seed, T0, KEYCODES });
  await page.goto(pathToFileURL(ORIGINAL).href, { waitUntil: "load" });
  return {
    page,
    initial: await page.evaluate(() => window.__blocks.state()), // the state window.onload's run() leaves
    // the original draws on every frame; the state after it is what the port must reproduce
    step: async ({ dt, keys = [] }) => page.evaluate(([d, k]) => { window.__blocks.step(d, k); return window.__blocks.state(); }, [dt, keys]),
    shot: (file) => page.screenshot({ path: file }),
    tape: () => page.evaluate(() => window.__blocks.tape()),
    close: () => browser.close(),
  };
}
