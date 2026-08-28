export type DesktopPlatform = "macos" | "windows" | "linux" | "web";

export type MenuCommand =
  | "preferences:open"
  | "repository:open-local"
  | "repository:clone"
  | "repository:center"
  | "sidebar:toggle"
  | "console:toggle"
  | "theme:system"
  | "theme:light"
  | "theme:dark";

export type WindowPlatformOptions = {
  frame?: boolean;
  titleBarStyle?: "default" | "hidden" | "hiddenInset" | "customButtonsOnHover";
  trafficLightPosition?: { x: number; y: number };
};

export type MenuDescriptorItem = {
  label?: string;
  role?: string;
  type?: "normal" | "separator" | "submenu" | "checkbox" | "radio";
  accelerator?: string;
  command?: MenuCommand;
  externalLink?: string;
  submenu?: MenuDescriptorItem[];
};

export type ShortcutEventLike = {
  key: string;
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

export type ParsedShortcut = {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  mod: boolean;
  key: string;
};

export const macMenuCommandValues: readonly MenuCommand[] = [
  "preferences:open",
  "repository:open-local",
  "repository:clone",
  "repository:center",
  "sidebar:toggle",
  "console:toggle",
  "theme:system",
  "theme:light",
  "theme:dark"
];

export const macExternalLinks = {
  homepage: "https://github.com/zjx150504-lgtm/Git_UI_Pro",
  releases: "https://github.com/zjx150504-lgtm/Git_UI_Pro/releases"
} as const;

const macMenuCommandSet = new Set<MenuCommand>(macMenuCommandValues);
const shortcutModifierAliases: Record<string, "ctrl" | "alt" | "shift" | "meta" | "mod"> = {
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift",
  meta: "meta",
  cmd: "meta",
  command: "meta",
  mod: "mod"
};
const shortcutModifierOrder = ["ctrl", "alt", "shift", "meta", "mod"] as const;

export function desktopPlatformForNodePlatform(platform: string): DesktopPlatform {
  if (platform === "darwin") {
    return "macos";
  }
  if (platform === "win32") {
    return "windows";
  }
  if (platform === "linux") {
    return "linux";
  }
  return "web";
}

export function createWindowOptions(platform: DesktopPlatform): WindowPlatformOptions {
  if (platform === "macos") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 14, y: 17 }
    };
  }
  return { frame: false };
}

export function isMenuCommand(value: unknown): value is MenuCommand {
  return typeof value === "string" && macMenuCommandSet.has(value as MenuCommand);
}

export function createMacMenuDescriptor(options: { isDev?: boolean } = {}): MenuDescriptorItem[] {
  const viewItems: MenuDescriptorItem[] = [
    { label: "显示项目侧栏", command: "sidebar:toggle" },
    { label: "显示控制台", command: "console:toggle" },
    { type: "separator" },
    { label: "跟随系统", type: "radio", command: "theme:system" },
    { label: "明亮", type: "radio", command: "theme:light" },
    { label: "黑暗", type: "radio", command: "theme:dark" },
    { type: "separator" },
    { label: "切换全屏", role: "togglefullscreen" }
  ];
  if (options.isDev) {
    viewItems.push({ label: "重新载入", role: "reload" });
  }

  return [
    {
      label: "Git UI Pro",
      submenu: [
        { label: "关于 Git UI Pro", role: "about" },
        { type: "separator" },
        { label: "设置…", accelerator: "CommandOrControl+,", command: "preferences:open" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideothers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "文件",
      submenu: [
        { label: "打开本地仓库…", accelerator: "CommandOrControl+O", command: "repository:open-local" },
        { label: "克隆仓库…", command: "repository:clone" },
        { label: "仓库中心…", command: "repository:center" },
        { type: "separator" },
        { role: "close" }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    { label: "视图", submenu: viewItems },
    {
      label: "窗口",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" }
      ]
    },
    {
      label: "帮助",
      submenu: [
        { label: "Git UI Pro 项目主页", externalLink: macExternalLinks.homepage },
        { label: "Git UI Pro 版本历史", externalLink: macExternalLinks.releases }
      ]
    }
  ];
}

type QueueMergeResult = {
  queue: MenuCommand[];
  accepted: boolean;
  reason?: "invalid-command" | "queue-full";
};

export function mergeMenuCommandQueue(queue: readonly MenuCommand[], command: MenuCommand, maxSize: number): QueueMergeResult {
  if (!isMenuCommand(command)) {
    return { queue: [...queue], accepted: false, reason: "invalid-command" };
  }

  const nextQueue = [...queue];
  if (command.startsWith("theme:")) {
    const firstThemeIndex = nextQueue.findIndex((item) => item.startsWith("theme:"));
    const withoutThemes = nextQueue.filter((item) => !item.startsWith("theme:"));
    if (firstThemeIndex >= 0) {
      withoutThemes.splice(Math.min(firstThemeIndex, withoutThemes.length), 0, command);
    } else {
      withoutThemes.push(command);
    }
    return { queue: withoutThemes, accepted: true };
  }

  if (command === "sidebar:toggle" || command === "console:toggle") {
    const toggleIndexes = nextQueue.flatMap((item, index) => item === command ? [index] : []);
    if ((toggleIndexes.length + 1) % 2 === 0) {
      return { queue: nextQueue.filter((item) => item !== command), accepted: true };
    }
    const withoutToggles = nextQueue.filter((item) => item !== command);
    const insertionIndex = toggleIndexes.length > 0
      ? Math.min(toggleIndexes[0], withoutToggles.length)
      : withoutToggles.length;
    withoutToggles.splice(insertionIndex, 0, command);
    return { queue: withoutToggles, accepted: true };
  }

  if (nextQueue.length >= Math.max(1, maxSize)) {
    return { queue: nextQueue, accepted: false, reason: "queue-full" };
  }
  nextQueue.push(command);
  return { queue: nextQueue, accepted: true };
}

export function parseShortcut(shortcut: string): ParsedShortcut | null {
  const tokens = shortcut.split("+").map((token) => token.trim().toLocaleLowerCase()).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }
  const modifiers = new Set<"ctrl" | "alt" | "shift" | "meta" | "mod">();
  const mainKeys: string[] = [];
  for (const token of tokens) {
    const modifier = shortcutModifierAliases[token];
    if (modifier) {
      if (modifiers.has(modifier)) {
        return null;
      }
      modifiers.add(modifier);
    } else {
      mainKeys.push(normalizeShortcutKey(token));
    }
  }
  if (mainKeys.length !== 1) {
    return null;
  }
  return {
    ctrl: modifiers.has("ctrl"),
    alt: modifiers.has("alt"),
    shift: modifiers.has("shift"),
    meta: modifiers.has("meta"),
    mod: modifiers.has("mod"),
    key: mainKeys[0]
  };
}

export function primaryModifierForPlatform(platform: DesktopPlatform): "meta" | "ctrl" {
  return platform === "macos" ? "meta" : "ctrl";
}

export function isPrimaryModifierPressed(event: ShortcutEventLike, platform: DesktopPlatform): boolean {
  return primaryModifierForPlatform(platform) === "meta" ? event.metaKey : event.ctrlKey;
}

export function matchesShortcut(event: ShortcutEventLike, shortcut: string, platform: DesktopPlatform): boolean {
  const parsed = parseShortcut(shortcut);
  if (!parsed) {
    return false;
  }
  const expectedCtrl = parsed.ctrl || (parsed.mod && platform !== "macos");
  const expectedMeta = parsed.meta || (parsed.mod && platform === "macos");
  if (event.ctrlKey !== expectedCtrl || event.altKey !== parsed.alt || event.shiftKey !== parsed.shift || event.metaKey !== expectedMeta) {
    return false;
  }
  const eventKey = normalizeShortcutKey(event.key);
  const eventCode = normalizeShortcutKey(event.code ?? "");
  return eventKey === parsed.key || eventCode === parsed.key;
}

export function formatShortcut(shortcut: string, platform: DesktopPlatform): string {
  const parsed = parseShortcut(shortcut);
  if (!parsed) {
    return shortcut;
  }
  const parts: string[] = [];
  if (parsed.ctrl) parts.push(platform === "macos" ? "⌃" : "Ctrl");
  if (parsed.alt) parts.push(platform === "macos" ? "⌥" : "Alt");
  if (parsed.shift) parts.push(platform === "macos" ? "⇧" : "Shift");
  if (parsed.meta) parts.push(platform === "macos" ? "⌘" : "Meta");
  if (parsed.mod) parts.push(platform === "macos" ? "⌘" : "Ctrl");
  parts.push(formatShortcutKey(parsed.key, platform));
  return platform === "macos" ? parts.join("") : parts.join("+");
}

export function shortcutInputToCanonical(value: string, platform: DesktopPlatform): string {
  const parsed = parseShortcut(expandDisplayedShortcut(value, platform));
  if (!parsed) {
    return value.trim();
  }
  const parts: string[] = [];
  if (parsed.ctrl) parts.push("Ctrl");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  if (parsed.meta) parts.push("Meta");
  if (parsed.mod) parts.push("Mod");
  parts.push(formatCanonicalShortcutKey(parsed.key));
  return parts.join("+");
}

export function logicalShortcutIdentity(shortcut: string, platform: DesktopPlatform): string | null {
  const parsed = parseShortcut(shortcut);
  if (!parsed) {
    return null;
  }
  const ctrl = parsed.ctrl || (parsed.mod && platform !== "macos");
  const meta = parsed.meta || (parsed.mod && platform === "macos");
  const modifiers = [
    ctrl ? "ctrl" : "",
    parsed.alt ? "alt" : "",
    parsed.shift ? "shift" : "",
    meta ? "meta" : ""
  ].filter(Boolean);
  return [...modifiers, parsed.key].join("+");
}

function normalizeShortcutKey(value: string): string {
  const key = value.trim().toLocaleLowerCase();
  if (key === "return") return "enter";
  if (key === "esc") return "escape";
  if (key === "spacebar") return "space";
  if (key === "`" || key === "backquote") return "backquote";
  return key === " " ? "space" : key;
}

function expandDisplayedShortcut(value: string, platform: DesktopPlatform): string {
  if (platform !== "macos") {
    return value;
  }
  const replacements: Record<string, string> = {
    "⌘": "Mod+",
    "⌃": "Ctrl+",
    "⌥": "Alt+",
    "⇧": "Shift+",
    "↩": "Enter",
    "⎋": "Escape",
    "␣": "Space"
  };
  return Array.from(value.trim()).reduce((result, character) => result + (replacements[character] ?? character), "");
}

function formatCanonicalShortcutKey(key: string): string {
  if (key === "backquote") return "`";
  return key.length === 1 ? key.toLocaleUpperCase() : key.replace(/^./, (character) => character.toLocaleUpperCase());
}

function formatShortcutKey(key: string, platform: DesktopPlatform): string {
  if (platform === "macos") {
    if (key === "enter") return "↩";
    if (key === "escape") return "⎋";
    if (key === "space") return "␣";
    if (key === "backquote") return "`";
  }
  if (key === "backquote") return "`";
  return key.length === 1 ? key.toLocaleUpperCase() : key.replace(/^./, (character) => character.toLocaleUpperCase());
}
