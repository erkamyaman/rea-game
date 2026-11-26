// Finds Playwright for the drivers that run an original in headless Chrome. It is not a dependency of this package:
// install it next to the repository (`npm install --no-save playwright`), or anywhere else and set PLAYWRIGHT_PATH
// to that install's playwright folder (e.g. /usr/local/lib/node_modules/playwright).
import { createRequire } from "node:module";

// Where to look, in order: a normal `require("playwright")`, then $PLAYWRIGHT_PATH, then two shared installs.
export function playwrightPlaces(env = process.env) {
  return ["playwright", env.PLAYWRIGHT_PATH, "/opt/node22/lib/node_modules/playwright", "/opt/node-tools/node_modules/playwright"].filter(Boolean);
}

export function loadPlaywright(places = playwrightPlaces()) {
  const require = createRequire(import.meta.url);
  for (const p of places) { try { return require(p); } catch {} }
  throw new Error("playwright not found; set PLAYWRIGHT_PATH");
}
