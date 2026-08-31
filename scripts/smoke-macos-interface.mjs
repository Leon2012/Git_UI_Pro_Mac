import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "@playwright/test";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
const productName = String(packageJson.build?.productName ?? packageJson.name);

if (process.platform !== "darwin") {
  console.log("[macos-smoke] 跳过：当前平台为 " + process.platform + "，原生 macOS 窗口和菜单只能在 macOS 上验证。");
  process.exit(0);
}

const appBundlePath = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
if (appBundlePath) {
  const bundleStat = await stat(appBundlePath);
  assert.equal(bundleStat.isDirectory(), true, "打包应用路径不是目录：" + appBundlePath);
  assert.match(appBundlePath, /\.app$/i, "smoke 参数必须是 .app 路径：" + appBundlePath);
}

const smokeDir = await mkdtemp(path.join(os.tmpdir(), "git-ui-pro-macos-interface-"));
const userDataDir = path.join(smokeDir, "user-data");
const screenshotDir = path.join(smokeDir, "screenshots");
const env = Object.fromEntries(
  Object.entries(process.env)
    .filter(([key, value]) => key !== "VITE_DEV_SERVER_URL" && value !== undefined)
    .map(([key, value]) => [key, value])
);
env.GIT_UI_PRO_INTERFACE_SMOKE = "1";
env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";

const executablePath = appBundlePath ? path.join(appBundlePath, "Contents", "MacOS", productName) : undefined;
const args = appBundlePath
  ? ["--user-data-dir=" + userDataDir]
  : ["--user-data-dir=" + userDataDir, rootDir];

let electronApp;
try {
  electronApp = await electron.launch({
    executablePath,
    args,
    cwd: rootDir,
    env,
    artifactsDir: smokeDir
  });
  const page = await electronApp.firstWindow({ timeout: 45_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.locator(".app-shell.platform-macos").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('.app-shell[data-initial-data-ready="true"]').waitFor({ state: "visible", timeout: 30_000 });

  await assertMacChrome(page);
  const menuSummary = await page.evaluate(async () => window.gitUI?.getNativeMenuSummary?.());
  assert.ok(Array.isArray(menuSummary), "未读取到原生菜单摘要。");
  assert.deepEqual(menuSummary.map((item) => item.label), ["Git UI Pro", "文件", "编辑", "视图", "窗口", "帮助"]);
  assertNativeMenu(menuSummary);

  const initialSidebarCollapsed = await readAppShellFlag(page, "left-collapsed");
  await invokeMenuItem(electronApp, "视图", { labelIncludes: "项目侧栏" });
  await waitForAppShellFlag(page, "left-collapsed", !initialSidebarCollapsed);
  await invokeMenuItem(electronApp, "视图", { labelIncludes: "项目侧栏" });
  await waitForAppShellFlag(page, "left-collapsed", initialSidebarCollapsed);

  const initialConsoleOpen = await readAppShellFlag(page, "console-open");
  await invokeMenuItem(electronApp, "视图", { labelIncludes: "控制台" });
  await waitForAppShellFlag(page, "console-open", !initialConsoleOpen);
  await invokeMenuItem(electronApp, "视图", { labelIncludes: "控制台" });
  await waitForAppShellFlag(page, "console-open", initialConsoleOpen);

  await invokeMenuItem(electronApp, "视图", { label: "黑暗" });
  await page.locator(".app-shell.theme-dark").waitFor({ state: "visible" });
  await page.screenshot({ path: path.join(screenshotDir, "macos-interface-dark.png"), fullPage: true });
  await invokeMenuItem(electronApp, "视图", { label: "明亮" });
  await page.locator(".app-shell.theme-light").waitFor({ state: "visible" });
  await page.screenshot({ path: path.join(screenshotDir, "macos-interface-light.png"), fullPage: true });

  await invokeMenuItem(electronApp, "Git UI Pro", { label: "设置…" });
  await page.locator(".repository-center").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "偏好设置" }).waitFor({ state: "visible" });

  await verifyWindowRecreation(electronApp, page);

  console.log("[macos-smoke] 原生菜单摘要、标题栏、侧栏、控制台、主题和偏好页通过。");
  console.log("[macos-smoke] 截图目录：" + screenshotDir);
} finally {
  await electronApp?.close();
}

function assertNativeMenu(summary) {
  const findTop = (label) => summary.find((item) => item.label === label);
  const view = findTop("视图");
  const app = findTop("Git UI Pro");
  const file = findTop("文件");
  const edit = findTop("编辑");
  const window = findTop("窗口");
  const help = findTop("帮助");
  assert.ok(app?.submenu?.some((item) => item.role === "about"), "应用菜单缺少 About role。");
  assert.ok(file?.submenu?.some((item) => item.command === "repository:clone"), "文件菜单缺少克隆命令。");
  assert.ok(edit?.submenu?.some((item) => item.role === "copy"), "编辑菜单缺少复制 role。");
  assert.ok(view?.submenu?.some((item) => item.command === "sidebar:toggle"), "视图菜单缺少侧栏命令。");
  assert.ok(file?.submenu?.some((item) => item.role === "close"), "文件菜单缺少关闭窗口 role。");
  assert.ok(window?.submenu?.some((item) => item.role === "minimize"), "窗口菜单缺少最小化 role。");
  assert.deepEqual(help?.submenu, [], "帮助菜单不应包含项目主页或版本历史入口。");
}

async function assertMacChrome(page) {
  await page.locator(".app-chrome").waitFor({ state: "visible" });
  await page.locator(".app-chrome-traffic-light-safe-zone").waitFor({ state: "attached" });
  await page.locator(".app-window-controls").waitFor({ state: "detached" });
  await page.locator(".app-chrome-settings-button").waitFor({ state: "detached" });
  await page.locator(".app-chrome-theme-control").waitFor({ state: "detached" });
}

async function invokeMenuItem(electronApp, topLevelLabel, selector) {
  await electronApp.evaluate(({ Menu, BrowserWindow }, input) => {
    const topLevel = Menu.getApplicationMenu()?.items.find((item) => item.label === input.topLevelLabel);
    const item = topLevel?.submenu?.items.find((candidate) => input.selector.labelIncludes
      ? candidate.label?.includes(input.selector.labelIncludes)
      : candidate.label === input.selector.label);
    if (!item) {
      throw new Error("找不到原生菜单项：" + input.topLevelLabel + " / " + JSON.stringify(input.selector));
    }
    item.click(item, BrowserWindow.getFocusedWindow(), undefined);
  }, { topLevelLabel, selector });
}

async function readAppShellFlag(page, className) {
  return page.locator(".app-shell").evaluate((element, name) => element.classList.contains(name), className);
}

async function waitForAppShellFlag(page, className, expected) {
  await page.locator(".app-shell").evaluate(async (element, input) => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && element.classList.contains(input.className) !== input.expected) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    if (element.classList.contains(input.className) !== input.expected) {
      throw new Error(`app-shell 状态未达到预期：${input.className}=${input.expected}`);
    }
  }, { className, expected });
}

async function verifyWindowRecreation(electronApp, page) {
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
  });
  await waitForWindowCount(electronApp, 0);

  // The native chooser is modal and platform-owned; cancel it inside smoke so
  // the test can verify the command delivery and window lifecycle deterministically.
  await electronApp.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });

  const recreatedWindowPromise = electronApp.waitForEvent("window", { timeout: 30_000 });
  await invokeMenuItem(electronApp, "文件", { label: "打开本地仓库…" });
  const recreatedPage = await recreatedWindowPromise;
  await recreatedPage.waitForLoadState("domcontentloaded");
  await recreatedPage.locator('.app-shell[data-initial-data-ready="true"]').waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(await readWindowCount(electronApp), 1, "打开本地仓库命令不应重复创建窗口。");

  await recreatedPage.reload();
  await recreatedPage.locator('.app-shell[data-initial-data-ready="true"]').waitFor({ state: "visible", timeout: 30_000 });
  const consoleInitiallyAfterReload = await readAppShellFlag(recreatedPage, "console-open");
  await invokeMenuItem(electronApp, "视图", { labelIncludes: "控制台" });
  await waitForAppShellFlag(recreatedPage, "console-open", !consoleInitiallyAfterReload);
  await invokeMenuItem(electronApp, "视图", { labelIncludes: "控制台" });
  await waitForAppShellFlag(recreatedPage, "console-open", consoleInitiallyAfterReload);
}

async function readWindowCount(electronApp) {
  return electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
}

async function waitForWindowCount(electronApp, expected) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await readWindowCount(electronApp) === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Electron 窗口数量未达到预期：${expected}`);
}
