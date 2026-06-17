import * as fs from "fs/promises";
import * as path from "path";
import { CLAUDE_CODE_PREFIX } from "../constants";
import { ClaudeCodeInstallation } from "../types";
import { getExtensionDirs, getIdeName } from "../utils/platform";

/**
 * Find ALL Claude Code installations across VS Code, Cursor, and Antigravity.
 *
 * We deliberately return every version that has a webview dir — not just the
 * "latest". IDEs like Antigravity keep many CC versions stacked on disk and we
 * cannot reliably know which one the editor will activate. Patching all of them
 * is cheap (a few file writes) and guarantees the active one is covered.
 */
export async function findClaudeCodeInstallations(): Promise<ClaudeCodeInstallation[]> {
  const extensionDirs = getExtensionDirs();
  const installations: ClaudeCodeInstallation[] = [];

  for (const extDir of extensionDirs) {
    try {
      const entries = await fs.readdir(extDir);
      const claudeDirs = entries.filter((e) => e.startsWith(CLAUDE_CODE_PREFIX));

      for (const dir of claudeDirs) {
        const version = dir.replace(CLAUDE_CODE_PREFIX, "").replace(/-.*$/, "");
        const fullPath = path.join(extDir, dir);

        // Verify webview directory exists (skips half-extracted updates)
        try {
          await fs.access(path.join(fullPath, "webview"));
          installations.push({
            path: fullPath,
            version,
            ide: getIdeName(extDir),
          });
        } catch {
          // No webview dir — skip
        }
      }
    } catch {
      // Directory doesn't exist — skip
    }
  }

  return installations;
}
