import assert from "node:assert/strict";
import test from "node:test";

let platformConfig;
let dispatcherModule;
try {
  platformConfig = await import("../dist-electron/platformConfig.js");
  dispatcherModule = await import("../dist-electron/menuCommandDispatcher.js");
} catch (error) {
  platformConfig = { loadError: error };
  dispatcherModule = { loadError: error };
}

test("平台映射和窗口选项区分 macOS 与非 macOS", () => {
  assert.equal(platformConfig.loadError, undefined);
  assert.equal(platformConfig.desktopPlatformForNodePlatform("darwin"), "macos");
  assert.equal(platformConfig.desktopPlatformForNodePlatform("win32"), "windows");
  assert.equal(platformConfig.desktopPlatformForNodePlatform("linux"), "linux");
  assert.equal(platformConfig.desktopPlatformForNodePlatform("freebsd"), "web");

  const macOptions = platformConfig.createWindowOptions("macos");
  assert.equal(macOptions.titleBarStyle, "hiddenInset");
  assert.notEqual(macOptions.frame, false);
  assert.deepEqual(macOptions.trafficLightPosition, { x: 14, y: 17 });
  assert.deepEqual(platformConfig.createWindowOptions("windows"), { frame: false });
  assert.deepEqual(platformConfig.createWindowOptions("linux"), { frame: false });
});

test("macOS 菜单描述包含系统角色和受控 renderer 命令", () => {
  assert.equal(platformConfig.loadError, undefined);
  const descriptor = platformConfig.createMacMenuDescriptor({ isDev: false });
  const serialized = JSON.stringify(descriptor);
  assert.equal(typeof serialized, "string");

  const findByCommand = (items, command) => items.find((item) => item.command === command);
  const topLevelLabels = descriptor.map((item) => item.label);
  assert.deepEqual(topLevelLabels, ["Git UI Pro", "文件", "编辑", "视图", "窗口", "帮助"]);
  assert.equal(findByCommand(descriptor[0].submenu, "preferences:open").accelerator, "CommandOrControl+,");
  assert.equal(findByCommand(descriptor[3].submenu, "theme:dark").type, "radio");
  assert.equal(descriptor[4].submenu.some((item) => item.command), false);
  assert.equal(descriptor[2].submenu.some((item) => item.role === "copy"), true);
  assert.equal(descriptor[5].submenu.find((item) => item.label === "Git UI Pro 版本历史").externalLink,
    "https://github.com/zjx150504-lgtm/Git_UI_Pro/releases");
});

test("菜单队列按 set、toggle、一次性动作语义合并", () => {
  const append = (queue, command) => platformConfig.mergeMenuCommandQueue(queue, command, 10).queue;
  let queue = [];
  queue = append(queue, "theme:light");
  queue = append(queue, "theme:dark");
  assert.deepEqual(queue, ["theme:dark"]);

  queue = [];
  queue = append(queue, "sidebar:toggle");
  queue = append(queue, "sidebar:toggle");
  assert.deepEqual(queue, []);
  queue = append(queue, "sidebar:toggle");
  queue = append(queue, "sidebar:toggle");
  queue = append(queue, "sidebar:toggle");
  assert.deepEqual(queue, ["sidebar:toggle"]);

  queue = append(queue, "repository:center");
  queue = append(queue, "preferences:open");
  assert.deepEqual(queue, ["sidebar:toggle", "repository:center", "preferences:open"]);
});

test("Mod 快捷键按平台匹配、格式化和计算冲突身份", () => {
  const macEvent = { key: "Enter", code: "Enter", ctrlKey: false, altKey: false, shiftKey: false, metaKey: true };
  const winEvent = { key: "Enter", code: "Enter", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false };
  assert.equal(platformConfig.matchesShortcut(macEvent, "Mod+Enter", "macos"), true);
  assert.equal(platformConfig.matchesShortcut(winEvent, "Mod+Enter", "windows"), true);
  assert.equal(platformConfig.matchesShortcut(macEvent, "Ctrl+Enter", "macos"), false);
  assert.equal(platformConfig.matchesShortcut({ ...macEvent, ctrlKey: true, metaKey: false }, "Ctrl+Enter", "macos"), true);
  assert.equal(platformConfig.formatShortcut("Mod+Enter", "macos"), "⌘↩");
  assert.equal(platformConfig.formatShortcut("Ctrl+Enter", "macos"), "⌃↩");
  assert.equal(platformConfig.formatShortcut("Mod+Enter", "windows"), "Ctrl+Enter");
  assert.equal(platformConfig.shortcutInputToCanonical("⌘⇧P", "macos"), "Shift+Mod+P");
  assert.equal(platformConfig.shortcutInputToCanonical("Ctrl+Shift+P", "windows"), "Ctrl+Shift+P");
  assert.equal(platformConfig.logicalShortcutIdentity("Mod+K", "windows"), platformConfig.logicalShortcutIdentity("Ctrl+K", "windows"));
  assert.notEqual(platformConfig.logicalShortcutIdentity("Mod+K", "macos"), platformConfig.logicalShortcutIdentity("Ctrl+K", "macos"));
});

test("菜单 dispatcher 在无窗口、ready、销毁和重复 ready 下保持命令一致", async () => {
  assert.equal(dispatcherModule.loadError, undefined);
  const sent = [];
  let currentWindow = null;
  let createCount = 0;
  const dispatcher = new dispatcherModule.MenuCommandDispatcher({
    getFocusedWindow: () => null,
    getFallbackWindow: () => currentWindow,
    createWindow: async () => {
      createCount += 1;
      currentWindow = { id: createCount, destroyed: false };
      return currentWindow;
    },
    isDestroyed: (window) => window.destroyed,
    send: (window, command) => sent.push({ id: window.id, command })
  });

  assert.equal(dispatcher.dispatch("repository:center"), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(createCount, 1);
  assert.deepEqual(dispatcher.pendingCommands(), ["repository:center"]);

  dispatcher.markReady(currentWindow);
  dispatcher.markReady(currentWindow);
  assert.deepEqual(sent, [{ id: 1, command: "repository:center" }]);
  assert.deepEqual(dispatcher.pendingCommands(), []);

  currentWindow.destroyed = true;
  dispatcher.invalidate(currentWindow);
  currentWindow = null;
  assert.equal(dispatcher.dispatch("preferences:open"), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(createCount, 2);
  assert.deepEqual(dispatcher.pendingCommands(), ["preferences:open"]);
  dispatcher.markReady(currentWindow);
  assert.deepEqual(sent, [
    { id: 1, command: "repository:center" },
    { id: 2, command: "preferences:open" }
  ]);
});
