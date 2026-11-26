// Runs the ORIGINAL Canvas Bird (originals/canvas-bird, MIT) unmodified in headless Chrome and
// observes it black-box through the canvas 2D context. Only its inputs are replaced: a fake clock
// (Date.now, performance.now, requestAnimationFrame), a seeded Math.random whose values go to a tape,
// and a stub Audio. Every rendered frame becomes a list of strings, one per draw call:
//   c:x:y:w:h                      clearRect
//   i:name:x:y                     drawImage(img, x, y)
//   s:name:sx:sy:sw:sh:dx:dy:dw:dh drawImage with a source rectangle
//   t:fill|stroke:text:x:y:style   fillText / strokeText with the raw style string last assigned
//   a:point|lose                   Audio.play() was called
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPlaywright } from "../../lib/playwright.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ORIGINAL = path.join(here, "../../originals/canvas-bird/index.html");
export const T0 = 1000000; // the fake clock's start, in ms (the port uses the same)

// runs in the page before any of its scripts
function install({ seed, T0 }) {
  let t = T0;
  const queue = [];
  let frame = [];
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
  Date.now = () => Math.floor(t);
  performance.now = () => t - T0;
  window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = () => {};
  const base = (s) => String(s).split("/").pop().replace(/\.[a-z0-9]+$/, "");
  window.Audio = function (src) { this.src = src; };
  window.Audio.prototype.play = function () { frame.push("a:" + base(this.src)); return Promise.resolve(); };
  const P = CanvasRenderingContext2D.prototype;
  const raw = { fillStyle: "#000000", strokeStyle: "#000000" };
  for (const k of ["fillStyle", "strokeStyle"]) {
    const d = Object.getOwnPropertyDescriptor(P, k);
    Object.defineProperty(P, k, { get() { return d.get.call(this); }, set(v) { raw[k] = String(v); d.set.call(this, v); }, configurable: true });
  }
  const wrap = (name, fn) => { const o = P[name]; P[name] = function (...args) { frame.push(fn(args)); return o.apply(this, args); }; };
  wrap("clearRect", (a) => "c:" + a.join(":"));
  wrap("drawImage", (a) => {
    const n = a[0] && a[0].getAttribute ? base(a[0].getAttribute("src")) : "?";
    return (a.length === 9 ? "s:" : "i:") + [n, ...a.slice(1)].join(":");
  });
  wrap("fillText", (a) => "t:fill:" + [a[0], a[1], a[2], raw.fillStyle].join(":"));
  wrap("strokeText", (a) => "t:stroke:" + [a[0], a[1], a[2], raw.strokeStyle].join(":"));
  window.__bird = {
    // one rendered frame: optionally click first, advance the clock, run the animation callbacks
    step(dt, click) {
      frame = [];
      if (click) document.getElementById("canvas").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      t += dt;
      const cbs = queue.splice(0);
      for (const cb of cbs) cb(t);
      return frame;
    },
    take() { const f = frame; frame = []; return f; },
    tape: () => tape.slice(),
  };
}

export async function openOriginal({ seed = 1, headless = true } = {}) {
  const { chromium } = loadPlaywright();
  let browser;
  try { browser = await chromium.launch({ headless }); }
  catch { browser = await chromium.launch({ headless, channel: "chrome" }); }
  const page = await browser.newPage({ viewport: { width: 700, height: 540 } });
  await page.route((u) => !u.protocol.startsWith("file"), (r) => r.abort()); // the page imports a web font
  await page.addInitScript(install, { seed, T0 });
  await page.goto(pathToFileURL(ORIGINAL).href, { waitUntil: "load" });
  const initial = await page.evaluate(() => window.__bird.take()); // the frame drawn by window.onload
  return {
    page,
    initial,
    step: ({ dt, click = false }) => page.evaluate(([d, c]) => window.__bird.step(d, c), [dt, !!click]),
    shot: (file) => page.screenshot({ path: file, clip: { x: 0, y: 0, width: 660, height: 500 } }),
    tape: () => page.evaluate(() => window.__bird.tape()),
    close: () => browser.close(),
  };
}
