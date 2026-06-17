// Minimal `vscode` API mock — just enough to load and exercise extension.ts
// outside the editor. Records UI calls so tests can assert on prompts.

export const calls = {
  info: [],
  warning: [],
  executedCommands: [],
};

export function _reset() {
  calls.info = [];
  calls.warning = [];
  calls.executedCommands = [];
}

let appName = "Visual Studio Code";
export function _setAppName(name) { appName = name; }

class MemState {
  constructor(initial = {}) { this.store = { ...initial }; }
  get(key, dflt) { return key in this.store ? this.store[key] : dflt; }
  async update(key, value) { this.store[key] = value; }
}

export function makeContext(initialGlobalState = {}) {
  return {
    subscriptions: [],
    globalState: new MemState(initialGlobalState),
  };
}

export const StatusBarAlignment = { Left: 1, Right: 2 };

export const window = {
  createOutputChannel() {
    return { appendLine() {}, dispose() {} };
  },
  createStatusBarItem() {
    return { text: "", tooltip: "", command: "", show() {}, dispose() {} };
  },
  async showInformationMessage(message, ...items) {
    calls.info.push(message);
    return undefined; // user dismisses → no reload triggered
  },
  async showWarningMessage(message, ...items) {
    calls.warning.push(message);
    return undefined;
  },
};

const registered = new Map();
export const commands = {
  registerCommand(id, handler) {
    registered.set(id, handler);
    return { dispose() { registered.delete(id); } };
  },
  async executeCommand(id, ...args) {
    calls.executedCommands.push(id);
    const h = registered.get(id);
    if (h) return h(...args);
  },
};

export const env = {
  get appName() { return appName; },
};

export class RelativePattern {
  constructor(base, pattern) { this.base = base; this.pattern = pattern; }
}

export const Uri = {
  file(p) { return { fsPath: p, scheme: "file" }; },
};

export const workspace = {
  createFileSystemWatcher() {
    return { onDidCreate() {}, onDidChange() {}, onDidDelete() {}, dispose() {} };
  },
};

export default {
  window, commands, env, workspace, StatusBarAlignment, RelativePattern, Uri,
};
