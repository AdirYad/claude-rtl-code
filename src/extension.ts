import * as vscode from "vscode";
import * as fs from "fs";
import { findClaudeCodeInstallations } from "./services/claudeCodeFinder";
import { inject, remove, getStatus } from "./services/fileInjector";
import { getExtensionDirs } from "./utils/platform";
import { CLAUDE_CODE_PREFIX } from "./constants";

const STATE_KEY = "claude-rtl.enabled";
const FIRST_RUN_KEY = "claude-rtl.firstRunDone";

let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let dirWatchers: fs.FSWatcher[] = [];
let reinjectTimer: ReturnType<typeof setTimeout> | undefined;

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("Claude RTL");

  context.subscriptions.push(
    vscode.commands.registerCommand("claude-rtl.enable", () => enableRtl(context)),
    vscode.commands.registerCommand("claude-rtl.disable", () => disableRtl(context))
  );

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  context.subscriptions.push(statusBarItem);

  const isEnabled = context.globalState.get<boolean>(STATE_KEY, true);
  if (isEnabled) {
    await ensureInjected(context);
    startWatching(context);
  }
  updateStatusBar(isEnabled);
}

export function deactivate() {
  // IMPORTANT: do NOT remove the patch here.
  //
  // deactivate() fires on every window CLOSE and RELOAD, not just on uninstall.
  // The old code stripped the injection here, which reverted the webview files
  // to LTR every time the editor closed — so the next launch loaded an
  // un-patched (LTR) webview and the user had to reload manually every time.
  //
  // The patch is intentionally persistent on disk. It is removed only by the
  // explicit "Claude RTL: Disable" command. This is the same trade-off the
  // popular "Custom CSS and JS Loader" extension makes.
  stopWatching();
}

// ── Commands ──

async function enableRtl(context: vscode.ExtensionContext) {
  const installations = await findClaudeCodeInstallations();
  if (installations.length === 0) {
    vscode.window.showWarningMessage("Claude RTL: No Claude Code installations found.");
    return;
  }

  let injected = 0;
  for (const inst of installations) {
    try {
      await inject(inst);
      injected++;
      log(`Injected RTL into ${inst.ide} (v${inst.version})`);
    } catch (err) {
      log(`Failed to inject into ${inst.ide} (v${inst.version}): ${err}`);
    }
  }

  await context.globalState.update(STATE_KEY, true);
  startWatching(context);
  updateStatusBar(true);

  if (injected > 0) {
    promptReload(`Claude RTL: Enabled for ${injected} installation(s). Reload window to apply.`);
  }
}

async function disableRtl(context: vscode.ExtensionContext) {
  const installations = await findClaudeCodeInstallations();
  let removed = 0;

  for (const inst of installations) {
    try {
      await remove(inst);
      removed++;
      log(`Removed RTL from ${inst.ide} (v${inst.version})`);
    } catch (err) {
      log(`Failed to remove from ${inst.ide} (v${inst.version}): ${err}`);
    }
  }

  await context.globalState.update(STATE_KEY, false);
  stopWatching();
  updateStatusBar(false);

  if (removed > 0) {
    promptReload(`Claude RTL: Disabled for ${removed} installation(s). Reload window to apply.`);
  }
}

// ── Injection ──

/**
 * Ensure every Claude Code install on disk is patched. Idempotent: only writes
 * to files that aren't already patched, so it's safe to call repeatedly (on
 * startup and from the directory watcher).
 *
 * Because the patch is persistent, a reload is only ever needed the FIRST time
 * we patch on a machine (the webview may have already loaded the un-patched file
 * in this session). After that, every launch loads the already-patched file —
 * no reload. New Claude Code versions are caught by the watcher before the
 * update's own mandatory reload, so they don't need an extra reload either.
 */
async function ensureInjected(context: vscode.ExtensionContext): Promise<void> {
  const installations = await findClaudeCodeInstallations();
  if (installations.length === 0) return;

  let patchedSomething = false;
  for (const inst of installations) {
    try {
      const status = await getStatus(inst);
      if (!status.cssInjected || !status.jsInjected) {
        await inject(inst);
        patchedSomething = true;
        log(`Auto-injected RTL into ${inst.ide} (v${inst.version})`);
      }
    } catch (err) {
      log(`Auto-inject failed for ${inst.ide} (v${inst.version}): ${err}`);
    }
  }

  const firstRunDone = context.globalState.get<boolean>(FIRST_RUN_KEY, false);
  if (patchedSomething && !firstRunDone) {
    promptReload("Claude RTL: Installed. Reload window once to apply RTL support.");
  }
  if (patchedSomething) {
    await context.globalState.update(FIRST_RUN_KEY, true);
  }
}

// ── Directory watching (catch Claude Code updates) ──

/**
 * Watch each IDE's extensions directory for new `anthropic.claude-code-*`
 * folders. When Claude Code updates, the editor extracts a NEW version folder
 * (un-patched). We patch it the moment it appears — before the update's own
 * reload activates it — so RTL is already in place and no extra reload is
 * needed. A non-recursive dir watch is cheap and only fires on top-level
 * entries (our own writes to webview/* live in subfolders and don't trigger it).
 */
function startWatching(context: vscode.ExtensionContext) {
  stopWatching();
  for (const dir of getExtensionDirs()) {
    try {
      const watcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
        if (filename && String(filename).startsWith(CLAUDE_CODE_PREFIX)) {
          scheduleReinject(context);
        }
      });
      watcher.on("error", () => {});
      dirWatchers.push(watcher);
    } catch {
      // Directory may not exist (IDE not installed) — skip.
    }
  }
}

function stopWatching() {
  if (reinjectTimer) {
    clearTimeout(reinjectTimer);
    reinjectTimer = undefined;
  }
  for (const w of dirWatchers) {
    try { w.close(); } catch { /* ignore */ }
  }
  dirWatchers = [];
}

/**
 * Debounce reinjection. An update fires many filesystem events while the new
 * folder is being written; we wait for it to settle, then patch. A couple of
 * delayed retries cover the case where the webview files aren't extracted yet.
 */
function scheduleReinject(context: vscode.ExtensionContext) {
  if (reinjectTimer) clearTimeout(reinjectTimer);
  reinjectTimer = setTimeout(async () => {
    reinjectTimer = undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      await ensureInjected(context);
      await delay(2000);
    }
  }, 2000);
}

// ── Helpers ──

function promptReload(message: string) {
  void vscode.window.showInformationMessage(message, "Reload Now").then((choice) => {
    if (choice === "Reload Now") {
      vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateStatusBar(enabled: boolean) {
  statusBarItem.text = enabled ? "$(arrow-swap) RTL" : "$(arrow-swap) LTR";
  statusBarItem.tooltip = enabled
    ? "Claude RTL: Active (click to disable)"
    : "Claude RTL: Inactive (click to enable)";
  statusBarItem.command = enabled ? "claude-rtl.disable" : "claude-rtl.enable";
  statusBarItem.show();
}

function log(message: string) {
  outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
}
