// Lifecycle regression test — captures the v1.0.4 "breaks on every restart" bug.
//
// The bug: deactivate() removed the on-disk patch on every window close, so the
// next launch loaded an un-patched (LTR) webview. This test pins the contract:
//
//   1. activate() patches the installed Claude Code webview files.
//   2. deactivate() (fires on every close/reload) leaves the patch in place.
//   3. A simulated Claude Code UPDATE (new version folder) gets patched.
//   4. The explicit Disable command DOES remove the patch.
//
// The extension is bundled as CJS with `vscode` left external, then a
// Module._load hook hands both the static `import` and the dynamic
// `require("vscode")` the SAME mock instance the test asserts against.
//
// Run: node test/lifecycle.test.mjs   (esbuild is a devDependency; no build needed)

import * as esbuild from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createRequire, Module } from "node:module";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync,
} from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// ── One shared `vscode` mock for both the extension and the assertions ──────
const M = await import(pathToFileURL(join(__dirname, "vscode-mock.mjs")).href);
const vscodeMock = {
  window: M.window, commands: M.commands, env: M.env, workspace: M.workspace,
  extensions: M.extensions,
  StatusBarAlignment: M.StatusBarAlignment, RelativePattern: M.RelativePattern, Uri: M.Uri,
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") return vscodeMock;
  return origLoad.call(this, request, parent, isMain);
};

// ── Bundle extension.ts as CJS, vscode external ─────────────────────────────
const outFile = join(tmpdir(), `claude-rtl-ext-${process.pid}.test.cjs`);
await esbuild.build({
  entryPoints: [join(repoRoot, "src/extension.ts")],
  bundle: true,
  outfile: outFile,
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["vscode"],
  logLevel: "silent",
});

const require = createRequire(import.meta.url);
const ext = require(outFile);

// ── Fake HOME with an Antigravity Claude Code install ───────────────────────
const home = mkdtempSync(join(tmpdir(), "claude-rtl-home-"));
const origUserProfile = process.env.USERPROFILE;
const origHome = process.env.HOME;
process.env.USERPROFILE = home;
process.env.HOME = home;
M._setAppName("Antigravity");

function makeInstall(version) {
  const root = join(home, ".antigravity", "extensions", `anthropic.claude-code-${version}-win32-x64`);
  const webview = join(root, "webview");
  mkdirSync(webview, { recursive: true });
  writeFileSync(join(webview, "index.css"), "body{color:red}\n", "utf-8");
  writeFileSync(join(webview, "index.js"), "console.log('cc');\n", "utf-8");
  return { root, css: join(webview, "index.css"), js: join(webview, "index.js") };
}

const isPatched = (p) => readFileSync(p, "utf-8").includes("CLAUDE-RTL");

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error("  FAIL:", msg); failures++; }
  else console.log("  ok:", msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const v1 = makeInstall("2.1.179");

  // 1. activate → patches
  let ctx = M.makeContext({ "claude-rtl.enabled": true });
  await ext.activate(ctx);
  await sleep(100);
  assert(isPatched(v1.css), "CSS patched after activate");
  assert(isPatched(v1.js), "JS patched after activate");

  // 2. deactivate (window close) must NOT strip the patch  ← the regression
  await ext.deactivate();
  await sleep(50);
  assert(isPatched(v1.css), "CSS still patched after deactivate (persists across restart)");
  assert(isPatched(v1.js), "JS still patched after deactivate (persists across restart)");

  // 2b. next launch: already patched → no reload prompt
  M._reset();
  ctx = M.makeContext({ "claude-rtl.enabled": true, "claude-rtl.firstRunDone": true });
  await ext.activate(ctx);
  await sleep(100);
  assert(isPatched(v1.css) && isPatched(v1.js), "still patched after relaunch");
  assert(M.calls.executedCommands.filter((c) => String(c).includes("reload")).length === 0,
    "no reload triggered on an already-patched relaunch");
  await ext.deactivate();

  // 3. Claude Code update: a new version folder appears → must get patched.
  const v2 = makeInstall("2.1.200");
  assert(!isPatched(v2.js), "new CC version starts un-patched");
  M._reset();
  ctx = M.makeContext({ "claude-rtl.enabled": true, "claude-rtl.firstRunDone": true });
  await ext.activate(ctx);
  await sleep(200);
  assert(isPatched(v2.css), "new CC version CSS patched after update+relaunch");
  assert(isPatched(v2.js), "new CC version JS patched after update+relaunch");

  // 3b. Claude Code update MID-SESSION: the fs watcher (started in activate)
  // patches a folder that appears while the editor is running — no relaunch.
  const v3 = makeInstall("2.1.250");
  assert(!isPatched(v3.js), "mid-session CC version starts un-patched");
  let patchedByWatcher = false;
  for (let i = 0; i < 12; i++) {        // up to ~6s for debounce + reinject
    await sleep(500);
    if (isPatched(v3.css) && isPatched(v3.js)) { patchedByWatcher = true; break; }
  }
  assert(patchedByWatcher, "fs watcher patched a new CC version mid-session (no relaunch)");
  await ext.deactivate();

  // 4. Explicit Disable removes the patch from all installs.
  ctx = M.makeContext({ "claude-rtl.enabled": true, "claude-rtl.firstRunDone": true });
  await ext.activate(ctx);
  await sleep(50);
  await M.commands.executeCommand("claude-rtl.disable");
  await sleep(50);
  assert(!isPatched(v1.css), "Disable removed patch from v1 css");
  assert(!isPatched(v2.css), "Disable removed patch from v2 css");
  await ext.deactivate();

  // 5. Fork IDE with a NON-standard extensions dir (e.g. Antigravity IDE).
  // The hardcoded dir list can't see it; discovery via the IDE's own extension
  // registry must. Regression for the "No Claude Code installations" report.
  const forkRoot = join(
    home, ".antigravity-ide", "extensions", "anthropic.claude-code-2.1.300-win32-x64"
  );
  const forkWebview = join(forkRoot, "webview");
  mkdirSync(forkWebview, { recursive: true });
  const forkCss = join(forkWebview, "index.css");
  const forkJs = join(forkWebview, "index.js");
  writeFileSync(forkCss, "body{color:red}\n", "utf-8");
  writeFileSync(forkJs, "console.log('cc');\n", "utf-8");
  M._setClaudeExtensionPath(forkRoot); // the IDE reports CC lives here
  assert(!isPatched(forkJs), "fork-IDE CC starts un-patched");
  M._reset();
  ctx = M.makeContext({ "claude-rtl.enabled": true, "claude-rtl.firstRunDone": true });
  await ext.activate(ctx);
  await sleep(100);
  assert(isPatched(forkCss), "fork-IDE CC CSS patched via extension-registry discovery");
  assert(isPatched(forkJs), "fork-IDE CC JS patched via extension-registry discovery");
  await ext.deactivate();
  M._setClaudeExtensionPath(undefined);
} finally {
  Module._load = origLoad;
  process.env.USERPROFILE = origUserProfile;
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(outFile, { force: true });
}

if (failures) { console.error(`\n${failures} assertion(s) failed`); process.exit(1); }
console.log("\nAll lifecycle tests passed.");
