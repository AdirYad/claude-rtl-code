import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { IDE_EXTENSION_DIRS, CLAUDE_CODE_EXTENSION_ID } from "../constants";

export type Platform = "win32" | "darwin" | "linux";

export function getPlatform(): Platform {
  return process.platform as Platform;
}

export function getHomeDir(): string {
  // On Windows via WSL, prefer USERPROFILE
  if (process.platform === "win32" && process.env.USERPROFILE) {
    return process.env.USERPROFILE;
  }
  return os.homedir();
}

/**
 * Resolve the extensions directory of the *running* IDE by asking it where the
 * Claude Code extension is installed. This is fork-agnostic: it works on any
 * VS Code fork (Antigravity IDE, Windsurf, …) whose extensions folder isn't one
 * of the hardcoded names in IDE_EXTENSION_DIRS. Without it, those forks report
 * "No Claude Code installations found". Returns undefined if Claude Code isn't
 * installed/visible or the API is unavailable.
 */
export function getClaudeCodeExtensionDir(): string | undefined {
  try {
    const ext = vscode.extensions.getExtension(CLAUDE_CODE_EXTENSION_ID);
    if (!ext) return undefined;
    // <extensions-dir>/anthropic.claude-code-<ver>-<plat>  →  <extensions-dir>
    return path.dirname(ext.extensionPath);
  } catch {
    return undefined;
  }
}

/** Get all possible extension directories for the current platform */
export function getExtensionDirs(): string[] {
  const home = getHomeDir();
  const platform = getPlatform();
  const dirs = (IDE_EXTENSION_DIRS[platform] || IDE_EXTENSION_DIRS.linux).map((dir) =>
    path.join(home, dir)
  );

  // Ask the running IDE where Claude Code actually lives. Covers VS Code forks
  // whose extensions dir isn't one of the hardcoded names above.
  const ccDir = getClaudeCodeExtensionDir();
  if (ccDir && !dirs.includes(ccDir)) dirs.push(ccDir);

  return dirs;
}

/** Extract IDE name from an extension directory path */
export function getIdeName(extDir: string): string {
  if (extDir.includes(".antigravity")) return "antigravity";
  if (extDir.includes(".cursor")) return "cursor";
  if (extDir.includes(".windsurf")) return "windsurf";
  return "vscode";
}
