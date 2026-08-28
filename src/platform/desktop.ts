import type { DesktopPlatform } from "../../electron/platformConfig";

const validPlatforms = new Set<DesktopPlatform>(["macos", "windows", "linux", "web"]);

export const MAC_SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif';
export const MAC_DISPLAY_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", sans-serif';
export const MAC_MONO_FONT = '"SFMono-Regular", "SF Mono", Menlo, Monaco, monospace';
export const NON_MAC_MONO_FONT = '"Cascadia Code", "Cascadia Mono", Consolas, "Courier New", monospace';

export function readDesktopPlatform(): DesktopPlatform {
  if (import.meta.env.DEV) {
    const injected = window.__TEST_DESKTOP_PLATFORM__;
    if (injected && validPlatforms.has(injected)) {
      return injected;
    }
  }
  const bridgePlatform = window.gitUI?.platform;
  return bridgePlatform && validPlatforms.has(bridgePlatform) ? bridgePlatform : "web";
}

export function desktopPlatformClass(platform: DesktopPlatform): string {
  return `platform-${platform}`;
}

export function systemFontForPlatform(platform: DesktopPlatform): string {
  return platform === "macos" ? MAC_SYSTEM_FONT : "var(--system-font, system-ui, sans-serif)";
}

export function monoFontForPlatform(platform: DesktopPlatform): string {
  return platform === "macos" ? MAC_MONO_FONT : NON_MAC_MONO_FONT;
}
