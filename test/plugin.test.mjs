import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
const pkg = read("package.json");

test("every plugin manifest has the package.json version", () => {
  for (const f of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
    assert.equal(read(f).version, pkg.version, f);
  }
});

test("both marketplaces list rea-games from the repository root", () => {
  const claude = read(".claude-plugin/marketplace.json").plugins.find((p) => p.name === "rea-games");
  assert.equal(claude.source, "./");
  const agents = read(".agents/plugins/marketplace.json").plugins.find((p) => p.name === "rea-games");
  assert.deepEqual(agents.source, { source: "local", path: "./" });
});

test("the Codex manifest points at files that exist and that npm ships", () => {
  const codex = read(".codex-plugin/plugin.json");
  for (const p of [codex.skills, codex.interface.logo]) assert.ok(fs.existsSync(path.join(root, p)), p);
  for (const dir of [".claude-plugin/", ".codex-plugin/", ".agents/", "skills/"]) assert.ok(pkg.files.includes(dir), dir);
});
