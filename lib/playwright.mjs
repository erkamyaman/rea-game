import { createRequire } from "node:module";

/** Loads Playwright from the repo, then from PLAYWRIGHT_PATH, then from the image-wide installs. */
export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const tries = ["playwright", process.env.PLAYWRIGHT_PATH, "/opt/node22/lib/node_modules/playwright", "/opt/node-tools/node_modules/playwright"].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch {} }
  throw new Error("playwright not found; set PLAYWRIGHT_PATH");
}
