# Git UI Pro macOS 全应用界面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在不改变 Git 工作流和 Windows/Linux 行为的前提下，将 Git UI Pro 的 macOS arm64 应用改造成具有原生交通灯、系统菜单和 Xcode/Finder 工具风格的完整桌面界面，并完成真实 Electron 与 arm64 包验证。

**Architecture:** 通过主进程平台能力层统一构造 macOS BrowserWindow、原生菜单、命令队列和菜单状态；preload 只暴露受限的 platform/menu bridge；React 通过单一菜单命令分发器更新现有状态。macOS 的视觉规则集中在最后加载的 `.platform-macos` 样式文件中，Windows/Linux 继续走现有分支。

**Tech Stack:** Electron 29、React 18、TypeScript strict、Vite、Playwright、Node `node:test`、electron-builder。

---

## 执行约束

- 以 `docs/superpowers/specs/2026-08-28-macos-interface-design.md` 为唯一产品和交互依据；遇到与旧代码冲突时按规格实现，并保持非 macOS 分支行为。
- 当前工作树已有 arm64 打包相关未提交改动，执行时只在其上增量修改，不回滚或覆盖这些改动。
- 项目规则禁止自动执行 `git commit` / `git push`；每个任务用 `git diff --check`、定向测试和状态检查作为 checkpoint，不创建提交。
- 不手工修改 `dist/`、`dist-electron/`、`release/`；构建产物只用于验证。
- 使用 `superpowers:executing-plans` 按任务顺序执行；若测试暴露既有环境依赖失败，记录证据并与本次回归分开。

## 文件责任表

- Create `electron/platformConfig.ts`: 平台映射、窗口选项、原生菜单描述、外链、菜单队列合并的纯函数。
- Create `electron/menuCommandDispatcher.ts`: 可注入窗口查找/创建/发送/销毁回调的菜单生命周期状态机。
- Create `src/platform/desktop.ts`: renderer 平台读取、测试平台注入防护和系统字体/菜单能力 helper。
- Create `src/vite-env.d.ts`: 为平台 helper 提供 Vite `ImportMeta.env` 类型。
- Extend `electron/platformConfig.ts`: `Mod` 语义、快捷键解析/匹配/格式化，保证 Node 测试和 renderer 共用同一份可编译实现。
- Create `src/styles/macos.css`: 仅 `.platform-macos` 作用域的全应用 Mac 视觉覆盖，最后加载。
- Create `scripts/test-macos-interface.mjs`: Node 纯函数和 bridge 合约测试。
- Create `scripts/verify-macos-arm64-artifacts.mjs`: 接收独立 output 目录并验证 DMG/ZIP/.app、目录架构和 native module 架构。
- Modify `electron/main.ts`: 平台化 BrowserWindow、macOS 菜单生命周期、ready/state IPC、主题同步和外链处理。
- Modify `electron/preload.ts`: 暴露 platform、menu ready/subscription/native menu state。
- Modify `src/types/electron.d.ts`: bridge、platform、menu command、native menu state 类型。
- Modify `src/App.tsx`: 平台根类、菜单命令分发、菜单状态同步、完整主题模式、仓库中心入口和字体变量。
- Modify `src/components/AppChrome.tsx`: macOS 与非 macOS 顶部栏分支。
- Modify `src/components/WorkspaceView.tsx`: `Mod+Enter` 提交/固定文件行为和平台化提示。
- Modify `src/components/WorktreeDetailPanel.tsx`: 媒体预览缩放 tooltip 和事件使用平台化主修饰键。
- Modify `src/components/RepositoryCenterContainer.tsx`: canonical 快捷键值与显示值的转换。
- Modify `src/components/RepositoryCenter.tsx`: Mac 快捷键显示和规范化输入保存。
- Modify `src/components/ConsolePanel.tsx`: 平台化 xterm 字体。
- Modify `electron/configStore.ts`: 默认 `Mod` 快捷键和规范化/冲突校验兼容。
- Modify `src/main.tsx`: 最后加载 `macos.css`。
- Modify `tests/ui/app-regression.spec.ts`: 平台注入、Mac/Windows 标题栏和菜单命令渲染回归。
- Modify `package.json`: 注册 `test:macos-interface` 和 `smoke:macos-interface` 定向脚本。

### Task 1: 建立平台、菜单和快捷键的可测试核心

**Files:**
- Create: `electron/platformConfig.ts`
- Create: `src/platform/desktop.ts`
- Extend: `electron/platformConfig.ts`
- Create: `scripts/test-macos-interface.mjs`
- Modify: `package.json`

- [x] **Step 1: 写失败测试，锁定平台和窗口契约**

在 `scripts/test-macos-interface.mjs` 使用 `node:test` 断言：

- `darwin` 映射为 `macos`，`win32` 映射为 `windows`，`linux` 映射为 `linux`，未知值映射为 `web`。
- macOS 窗口选项包含 `titleBarStyle: "hiddenInset"`、原生 frame 策略和初始交通灯位置；Windows/Linux 保持 `frame: false`。
- macOS 菜单命令只允许 `preferences:open`、`repository:open-local`、`repository:clone`、`repository:center`、`sidebar:toggle`、`console:toggle`、`theme:system`、`theme:light`、`theme:dark`。

运行：

```bash
npm run build:electron && node --test scripts/test-macos-interface.mjs
```

预期：在 helper 尚未实现前失败，失败应指向缺少模块或缺少导出，而不是测试脚本自身语法错误。

- [x] **Step 2: 写失败测试，锁定菜单队列和 `Mod` 语义**

继续补充测试：

- `theme:*` 只保留最后一个主题 set 命令。
- 两次 `sidebar:toggle` / `console:toggle` 抵消，三次保留一次。
- `repository:*` 与 `preferences:open` 保持 FIFO。
- `Mod+Enter` 在 macOS 匹配 `metaKey`，Windows/Linux 匹配 `ctrlKey`。
- 显式 `Ctrl+Enter` 始终只匹配 `ctrlKey`，不能在 macOS 被转换为 Command。
- 快捷键格式化在 macOS 显示 `⌘`、`⌥`、`⇧`、`⌃`，Windows/Linux 显示 `Ctrl`、`Alt`、`Shift`。

- [x] **Step 3: 实现最小纯函数核心**

在 `electron/platformConfig.ts` 导出无副作用 helper；该文件只能使用 type-only Electron 导入或纯标准库，不能在 renderer bundle 中引入 `electron` runtime：

- `desktopPlatformForNodePlatform()`。
- `createWindowOptions(platform)`，只返回平台相关 BrowserWindow 选项。
- `macMenuCommandValues` 和 `isMenuCommand()`。
- `mergeMenuCommandQueue(queue, command, maxSize)`，按 set/toggle/action 语义合并并在一次性动作超限时返回可诊断拒绝结果。
- `macExternalLinks`，固定为项目主页和 Releases HTTPS URL。
- `createMacMenuDescriptor(options)`，只返回可 JSON 序列化的 `role`、`label`、`accelerator`、`command`、`externalLink` 和 submenu 数据，不包含函数回调。
- `ShortcutEventLike` 结构类型，以及 `parseShortcut`、`matchesShortcut`、`formatShortcut`、`primaryModifierForPlatform`、`logicalShortcutIdentity`；这些 helper 不引用 DOM 类型，供 Node 测试和 renderer 直接复用。

在 `src/platform/desktop.ts` 导出 renderer 平台读取和 CSS class helper；生产构建忽略 `window.__TEST_DESKTOP_PLATFORM__`，开发/测试构建才允许使用它。

- [x] **Step 4: 运行核心测试并做类型检查**

运行：

```bash
npm run build:electron && node --test scripts/test-macos-interface.mjs
npm run typecheck
```

预期：核心 Node 测试通过；若 renderer 尚未接入 helper，typecheck 只允许出现计划中尚未修改文件的预期缺口，不得留下未使用导出或隐式 `any`。

### Task 2: 实现 Electron 原生窗口、菜单和生命周期

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`
- Modify: `electron/platformConfig.ts`
- Create: `electron/menuCommandDispatcher.ts`
- Test: `scripts/test-macos-interface.mjs`

- [x] **Step 1: 为 bridge 和生命周期写失败测试**

针对 `electron/menuCommandDispatcher.ts` 的真实状态机注入 fake window lookup/create/send callbacks，验证：

- `notifyMenuReady` 在 StrictMode 重复调用时幂等。
- 只有当前有效窗口的 ready/state 消息能改变队列状态。
- reload、导航、销毁会使旧 ready 失效。
- 启动中、无窗口、窗口重建时菜单命令只发送一次。

测试不得只 mock `main.ts` 的私有变量；`main.ts` 只负责把 Electron BrowserWindow 适配为 dispatcher 依赖。

- [x] **Step 2: 平台化 `createWindow()`**

将当前固定 `frame: false` 改为调用 `createWindowOptions(process.platform)`：

- macOS 使用 `titleBarStyle: "hiddenInset"`、原生交通灯和约 `{ x: 14, y: 17 }` 的 `trafficLightPosition`。
- Windows/Linux 继续使用 `frame: false` 和现有窗口控制行为。
- 以配置主题计算 `backgroundColor`，不在 macOS 浅色模式启动时先显示硬编码深色背景。
- 注册 `did-finish-load`、导航和销毁事件，维护当前窗口的 ready 状态。

- [x] **Step 3: 构建 macOS 原生菜单模板**

在 macOS 创建 `Git UI Pro`、`文件`、`编辑`、`视图`、`窗口`、`帮助` 菜单：

- 原生角色负责编辑、隐藏、退出、关闭窗口、最小化、缩放、全屏等系统行为。
- 先调用 `createMacMenuDescriptor()` 得到纯数据，再由 `main.ts` 的 Electron adapter 将 `command`/`externalLink` 字段转换为带 `click` 回调的 `MenuItemConstructorOptions`，最后调用 `Menu.buildFromTemplate()`。
- React 状态命令通过 `dispatchMenuCommand()` 进入真实 dispatcher 队列或发送到已 ready 窗口。
- “关于 Git UI Pro”完全由主进程 `app.showAboutPanel()` 或等价原生对话框处理。
- “Git UI Pro 项目主页”和“Git UI Pro 版本历史”只打开固定 HTTPS 外链，使用现有协议校验。
- 非 macOS 继续 `Menu.setApplicationMenu(null)`。

- [x] **Step 4: 实现菜单命令 IPC 和状态 IPC**

在 preload 暴露：

- `platform`。
- `onMenuCommand(callback)`。
- `notifyMenuReady()`。
- `setNativeMenuState(state)`。

在主进程注册带来源窗口校验的 `app:menuReady` 和 `app:setNativeMenuState`；发送前检查 `webContents.isDestroyed()`。

- [x] **Step 5: 实现主题运行时同步**

初始化 ConfigStore 后读取 `system/light/dark`，设置 `nativeTheme.themeSource`。监听 `nativeTheme.updated`：仅在 `system` 模式重新计算有效窗口 `backgroundColor` 并让 renderer 通过现有主题 effect 更新；退出时移除监听。

- [x] **Step 6: 运行 Electron 核心测试**

运行：

```bash
npm run build:electron && node --test scripts/test-macos-interface.mjs
npm run typecheck
```

预期：窗口/菜单/队列/bridge 纯函数和合约测试通过；主进程没有新增 `any`、未校验外部 URL 或向已销毁窗口发送事件。

### Task 3: 接入 App 状态、主题、菜单命令和平台根类

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/types/electron.d.ts`
- Modify: `src/platform/desktop.ts`
- Modify: `src/components/RepositoryCenterContainer.tsx`: 传递 clone 输入焦点目标。
- Modify: `src/components/RepositoryCenter.tsx`: 消费 clone 输入焦点目标并在页签激活后聚焦。

- [x] **Step 1: 写失败的 renderer 菜单行为测试**

扩展 Playwright fixture，在 React 初始化前注入 `__TEST_DESKTOP_PLATFORM__ = "macos"`，并 mock `window.gitUI`：

- 根节点包含 `platform-macos`。
- `preferences:open` 打开仓库中心并进入 `preferences` 页。
- `repository:center` 按“有项目 recovery、无项目 projects”打开。
- `repository:clone` 打开 projects 页并把焦点放入克隆地址输入框。
- `sidebar:toggle` / `console:toggle` 改变真实可见状态。
- `theme:system/light/dark` 改变主题类、持久化值和发送给主进程的菜单状态。

- [x] **Step 2: 接入平台和 menu-ready 顺序**

在 `App.tsx` 初始化 effect 中先注册 `onMenuCommand`，再调用 `notifyMenuReady()`；卸载时取消订阅。所有命令进入一个统一的 `handleMenuCommand`，不得在 AppChrome 和主进程重复实现业务逻辑。

- [x] **Step 3: 补齐主题状态和原生菜单状态同步**

- `readThemeMode()` 保留 `system`。
- `selectThemeMode()` 接受完整 `ThemeMode`。
- `resolveTheme()` 只负责将 system 解析为 light/dark。
- 在主题、侧栏、控制台状态变化后调用 `setNativeMenuState`。
- 菜单状态同步失败只记录可见错误，不阻塞现有界面操作。

- [x] **Step 4: 实现各命令最终状态落点**

- `preferences:open` 设置 `repositoryCenterInitialTab = "preferences"` 并打开中心。
- `repository:open-local` 复用现有 `handleAddProject()`。
- `repository:clone` 设置 projects 初始页和一次性 clone 输入焦点目标。
- `repository:center` 保持当前 recovery/projects 语义。
- 侧栏、控制台和主题命令复用现有 setter/persistence 函数。

- [x] **Step 5: 调整根元素字体变量和平台 class**

将现有 inline `--app-font` 从直接覆盖字体改为字体模式/平台令牌引用；根 class 同时保留现有 `theme-*`、density、sidebar、console 状态并追加稳定的 `platform-*` class。

- [x] **Step 6: 运行 renderer 定向测试**

运行：

```bash
npm run typecheck
npx playwright test tests/ui/app-regression.spec.ts
```

预期：Mac 注入用例断言最终页面和焦点；web 默认回归仍按原有非 macOS 路径运行。

### Task 4: 改造 AppChrome 和 macOS 标题栏交互

**Files:**
- Modify: `src/components/AppChrome.tsx`
- Modify: `src/styles/app.css`
- Create/Modify: `src/styles/macos.css`
- Modify: `src/main.tsx`
- Test: `tests/ui/app-regression.spec.ts`

- [x] **Step 1: 更新失败的标题栏几何断言**

将现有直接解引用 `.app-window-controls` 的测试改为平台分支：

- macOS 断言 `.app-window-controls`、顶部设置/主题/update 控件不存在，交通灯安全区存在，标题栏高度约 50px。
- web/Windows 断言现有窗口控制、品牌和应用内入口仍存在。
- 两个平台都断言标题长文本省略、拖拽区和按钮不重叠。

- [x] **Step 2: 实现 AppChrome 平台分支**

macOS：

- 删除 React 模拟窗口按钮、品牌图标、设置文字、主题下拉和 `AppUpdateControl` 的渲染。
- 保留侧栏按钮、当前项目标题和空白拖拽区。
- 增加 72px 交通灯安全区，所有按钮明确 `no-drag`。

非 macOS 保持现有结构和 `window:minimize`、`window:toggleMaximize`、`window:close` 命令。

- [x] **Step 3: 加入 macOS 样式入口和标题栏规则**

在 `src/main.tsx` 最后导入 `./styles/macos.css`。先实现标题栏、拖拽区、交通灯安全区、项目标题、Mac 图标按钮的限定规则，再运行截图检查。

- [x] **Step 4: 运行标题栏回归**

运行：

```bash
npx playwright test tests/ui/app-regression.spec.ts --grep "标题栏|窗口|平台"
npm run typecheck
```

### Task 5: 完成 Xcode/Finder 全应用 macOS 视觉覆盖

**Files:**
- Modify: `src/styles/app.css`
- Modify: `src/styles/liquid-glass.css` only where existing precedence blocks platform rules
- Create: `src/styles/macos.css`
- Modify: `src/styles/repository-center.css` only for uncovered Mac dialog/tool surfaces
- Test: `tests/ui/app-regression.spec.ts`

- [x] **Step 1: 写视觉验收用例和稳定选择器**

为 Playwright 增加可读的区域选择器/断言，覆盖设计规格矩阵：标题栏、项目侧栏、工作区工具栏、变更/提交区、Git 图谱、Diff/文件预览、控制台、仓库中心、远程仓库弹窗、确认弹窗、上下文/浮动菜单、tooltip、toast，以及 loading/empty/error/disabled/focus 状态。

- [x] **Step 2: 写 Mac 令牌和字体规则**

在 `.platform-macos` 及 `.platform-macos.theme-light/.theme-dark` 下定义：

- `--system-font`、`--display-font`、`--mono-font`、`--app-font`。
- 窗口/主内容/侧栏/分隔线/文字/系统蓝/语义 Git 色。
- 代码、Diff、终端的稳定不透明工作表面。

将硬编码 `Cascadia Code` / `Consolas` 的通用工作区规则迁移到变量或平台 helper，避免改变 Windows 字体回归。

- [x] **Step 3: 统一控件、面板和浮层**

在 `macos.css` 定向覆盖：

- 28px 至 30px 图标按钮、紧凑文本按钮、5px 至 6px 输入框、2px focus ring。
- Finder 源列表式侧栏、细分隔线、低强度选中 tint。
- Xcode Debug Area 式控制台顶栏和稳定终端表面。
- 仓库中心工具对话框、远程/分支/合并/确认对话框。
- 菜单、上下文菜单、tooltip、toast 和窄覆盖式滚动条。
- `prefers-reduced-motion` 和高对比度覆盖。

禁止新增嵌套卡片、重玻璃主工作面、大面积渐变或平台作用域外的选择器。

- [x] **Step 4: 运行截图驱动的浏览器 QA**

运行：

```bash
npx playwright test tests/ui/app-regression.spec.ts
```

分别以 web 默认、Mac 注入、浅色、深色、1280×800 和接近 860×640 检查矩阵。记录失败截图并逐项修正，直到文字无截断、控件无重叠、工作区无透明度可读性回退。

### Task 6: 统一 `Mod` 快捷键和终端字体

**Files:**
- Modify: `electron/platformConfig.ts`
- Modify: `electron/configStore.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/WorkspaceView.tsx`
- Modify: `src/components/WorktreeDetailPanel.tsx`
- Modify: `src/components/RepositoryCenterContainer.tsx`
- Modify: `src/components/RepositoryCenter.tsx`
- Modify: `src/components/ConsolePanel.tsx`
- Test: `scripts/test-macos-interface.mjs`
- Test: `tests/ui/app-regression.spec.ts`

- [x] **Step 1: 写快捷键行为失败测试**

断言默认配置使用 `Mod+K`、`Mod+Shift+R`、`Mod+Shift+F`、`Mod+Shift+L`、`Mod+Shift+P`、`Mod+\``；显式已保存的 `Ctrl+...` 不被迁移。断言提交和文件固定的 Meta/Ctrl 事件行为及提示文本一致；ConsolePanel 的复制/粘贴 tooltip 使用 `formatShortcut()`，Mac 显示 `⌘C` / `⌘V`，Windows/Linux 保留 Ctrl 文案并覆盖备用 Shift+Insert 行为。补充 `logicalShortcutIdentity()` 测试：Windows/Linux 上 `Mod+K` 与 `Ctrl+K` 冲突，macOS 上二者可并存。

- [x] **Step 2: 实现配置规范化兼容**

在 `electron/configStore.ts` 支持 `Mod` 作为跨平台逻辑修饰符并保持显式 `Ctrl` / `Meta`；冲突校验按 `logicalShortcutIdentity(shortcut, platform)` 计算，Windows/Linux 的 `Mod+K` 与 `Ctrl+K` 必须冲突，macOS 的 `Mod+K` 与 `Ctrl+K` 可以并存。规范化存储不能把用户显式 Control 改成 Command。`matchesShortcut()` 只接收 `ShortcutEventLike`，不得引用 DOM `KeyboardEvent`，renderer 的原生事件依赖结构兼容传入。

- [x] **Step 3: 接入 App 和 WorkspaceView**

移除 `App.tsx` 内重复的解析/匹配函数，统一使用 `electron/platformConfig.ts` 编译产物中的 helper。WorkspaceView 的提交和固定文件 `onKeyDown` 使用 `isPrimaryModifierPressed`，placeholder/tooltip 使用 `formatShortcut("Mod+Enter", platform)`。WorktreeDetailPanel 的媒体预览缩放 tooltip 和事件改用同一 helper，消除 `Ctrl + -`、`Ctrl + +`、`Ctrl + 0` 的硬编码。

RepositoryCenterContainer 将持久化的 canonical 快捷键语法转换为平台显示值；RepositoryCenter 输入框允许显示 `⌘` 等 Mac 符号，但提交时转换回 `Mod`、`Ctrl` 或 `Meta` 语法再交给 ConfigStore 校验。

- [x] **Step 4: 平台化 xterm 字体**

ConsolePanel 使用实际字体字符串 helper：macOS 为 SFMono/Menlo 系列，其他平台保留 Cascadia/Consolas/Courier fallback；xterm 不直接依赖 CSS 变量。

- [x] **Step 5: 运行快捷键测试**

运行：

```bash
npm run build:electron && node --test scripts/test-macos-interface.mjs
npx playwright test tests/ui/app-regression.spec.ts --grep "快捷键|提交|固定"
npm run typecheck
```

### Task 7: 真实 Electron 窗口和原生菜单 smoke

**Files:**
- Create: `scripts/smoke-macos-interface.mjs` (macOS-only, no-op with clear message elsewhere)
- Modify: `package.json`: 注册 `smoke:macos-interface`。
- Modify: `tests/ui/app-regression.spec.ts`: 仅负责 renderer-side assertions。
- Modify: `electron/main.ts`: 在 `GIT_UI_PRO_INTERFACE_SMOKE=1` 时提供测试专用菜单摘要 IPC。
- Modify: `electron/preload.ts`: 暴露受限的 `getNativeMenuSummary()`，非 smoke 模式调用必须拒绝。

- [x] **Step 1: 写 smoke 脚本的失败检查**

脚本使用 `@playwright/test` 的 `_electron.launch()` 启动当前开发 server 或已构建 Electron app，并设置 `GIT_UI_PRO_INTERFACE_SMOKE=1`；支持一个可选 `.app` 路径参数，传入时必须启动该精确产物；等待 renderer ready 后检查：

- `platform-macos` 和 Mac 标题栏结构。
- 通过测试专用 `getNativeMenuSummary()` IPC 读取原生菜单的 label、role、accelerator 和 command 摘要，确认标准应用/编辑/视图/窗口/帮助菜单存在且没有 Windows 自绘窗口按钮。
- 菜单命令可驱动偏好页、侧栏、控制台和主题状态。
- 浅色/深色首屏截图已保存到临时验证目录。

- [x] **Step 2: 接入真实 Electron 自动化/人工检查点**

在 arm64 macOS 上通过 `_electron.launch()` 启动 `electron .` 或传入的打包 `.app`，用 `app.evaluate(({ Menu }) => ...)` 与测试 IPC 验证系统菜单摘要，用窗口 screenshot 验证真实标题栏渲染；人工点击交通灯和系统菜单作为补充检查。记录窗口尺寸、菜单摘要、点击结果和截图路径，不能把浏览器 Playwright 单独当作原生验证。

- [x] **Step 3: 验证窗口生命周期**

关闭最后一个窗口后从系统菜单触发“打开本地仓库”，验证窗口重建和目录选择流程；启动中触发菜单验证命令只执行一次；reload/重新激活后验证菜单仍工作。

- [x] **Step 4: 运行 smoke**

运行：

```bash
npm run build
node scripts/smoke-macos-interface.mjs
```

预期：真实 Electron 首屏、原生交通灯、系统菜单、主题切换和窗口生命周期通过；脚本在非 macOS 环境明确报告跳过原因而不是伪造通过。

### Task 8: 完整验证并重建正式 macOS arm64 包

**Files:**
- Modify: `docs/PACKAGING.md`: 记录 macOS 界面 smoke 和 arm64 构建验证命令。
- Modify: `package.json`: 确保所有新增测试/smoke 命令可直接调用。
- Create: `scripts/verify-macos-arm64-artifacts.mjs`: 使用传入的 output 目录动态解析版本并执行架构/完整性/native module 检查。
- Do not edit generated: `dist/`, `dist-electron/`, `release/`

- [x] **Step 1: 执行代码和 UI 验证**（`npm test` 的 release-console 子测试仍有 1 个与本次改动无关的本机远端配置失败，详见最终报告。）

依次运行：

```bash
npm run typecheck
npm run build
npm run test:macos
npx playwright test
```

全量 `npm test` 也要执行；如果既有 `scripts/test-release-console.mjs` 因本机 remote provider 配置失败，保留完整错误并标明是环境依赖，不把它描述为本次修复通过。

- [x] **Step 2: 在干净暂存目录构建并验证 arm64**

在 arm64 macOS 上先创建只属于本次验证的临时输出目录，把该目录作为 electron-builder 的明确 output；以下代码块必须作为一个 shell 脚本整体执行，不能依赖跨代码块的变量：

```bash
set -euo pipefail
MACOS_OUTPUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/git-ui-pro-macos-arm64.XXXXXX")"
npm run verify:macos
npm run dist:mac -- --config.directories.output="$MACOS_OUTPUT_DIR" --publish never
node scripts/verify-macos-arm64-artifacts.mjs "$MACOS_OUTPUT_DIR"
node scripts/smoke-macos-interface.mjs "$MACOS_OUTPUT_DIR/mac-arm64/Git UI Pro.app"
```

`verify-macos-arm64-artifacts.mjs` 必须断言：恰好一个 arm64 DMG、一个 arm64 ZIP、一个 `mac-arm64/Git UI Pro.app` 目录；不存在 `mac-x64`、`mac-universal` 或其他架构目录；DMG/ZIP 完整性通过；主可执行文件和 `app.asar.unpacked` 下每个关键 `.node` 文件经 `file`/`lipo -info` 确认为 arm64。脚本必须使用动态 `package.json` 版本和精确路径，不扫描或引用历史 `release/`。

- [x] **Step 3: 确认打包应用启动和原生界面结果**

上述同一 shell 块已经把精确的 `mac-arm64/Git UI Pro.app` 路径交给 Task 7 的 smoke 脚本，而不是启动工作树中的旧版本；确认原生菜单、交通灯、首屏渲染、主题切换和窗口生命周期通过。未配置 Developer ID 时，额外记录签名/公证缺失，不将其描述为 Gatekeeper 可直接放行。

- [x] **Step 4: 交付前状态检查**

运行：

```bash
git diff --check
git status --short
```

保留所有用户已有改动，不自动 commit/push。最终报告必须区分：代码/测试状态、arm64 产物路径和校验结果、Apple 签名/公证状态。
