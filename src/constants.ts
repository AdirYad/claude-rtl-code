// CSS injection markers — used to identify and remove our injected code
export const CSS_MARKER_START = "/* === CLAUDE-RTL-START === */";
export const CSS_MARKER_END = "/* === CLAUDE-RTL-END === */";
export const JS_MARKER_START = "/* === CLAUDE-RTL-JS-START === */";
export const JS_MARKER_END = "/* === CLAUDE-RTL-JS-END === */";

// RTL character detection — Hebrew, Arabic, Arabic Supplement, Arabic Presentation Forms
export const RTL_REGEX_SOURCE =
  "[\\u0590-\\u05FF\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF]";

// IDE extension directory names
export const IDE_EXTENSION_DIRS: Record<string, string[]> = {
  win32: [".vscode/extensions", ".cursor/extensions", ".antigravity/extensions"],
  darwin: [".vscode/extensions", ".cursor/extensions", ".antigravity/extensions"],
  linux: [
    ".vscode/extensions",
    ".vscode-server/extensions",
    ".cursor/extensions",
    ".cursor-server/extensions",
    ".antigravity/extensions",
  ],
};

// Claude Code extension ID prefix
export const CLAUDE_CODE_PREFIX = "anthropic.claude-code-";

// Claude Code extension identifier (publisher.name), used to ask the running
// IDE where Claude Code is installed — fork-agnostic, unlike the dir names above.
export const CLAUDE_CODE_EXTENSION_ID = "anthropic.claude-code";

// Webview files relative to Claude Code extension root
export const WEBVIEW_CSS = "webview/index.css";
export const WEBVIEW_JS = "webview/index.js";
