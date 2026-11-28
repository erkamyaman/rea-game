// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { listGames, loadGame } from "../lib/verify.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("every game names its original as a GitHub owner/repo", () => {
  const games = listGames(root);
  assert.ok(games.length > 0);
  for (const g of games) {
    const { meta } = loadGame(root, g);
    assert.match(meta.original?.repo ?? "", /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/, g);
  }
});
