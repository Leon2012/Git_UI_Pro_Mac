# Git UI Pro macOS 全应用界面设计

日期：2026-08-28  
状态：已确认方向，已按第一轮规格审查修订  
目标平台：macOS arm64  
视觉方向：Xcode / Finder 式原生桌面工具

## 1. 背景与结论

当前应用虽然可以打包为 macOS arm64，但窗口框架、顶部菜单、字体、按钮、弹层、快捷键文案和滚动条仍主要沿用 Windows 桌面习惯：Electron 窗口在所有平台都使用 `frame: false`，渲染层自行绘制最小化、最大化和关闭按钮，应用菜单被整体禁用，主字体优先使用 Segoe UI，等宽字体优先使用 Cascadia Code / Consolas。

本次改造采用平台分支，而不是把 Windows 外观替换成一套跨平台伪 macOS 皮肤：

- macOS 使用 Electron 原生标题栏融合模式、系统交通灯和原生应用菜单。
- macOS 渲染层采用克制的 Xcode / Finder 工具型视觉，强调紧凑、清晰、层级稳定。
- Windows 和 Linux 保留现有无边框窗口、右侧窗口控制按钮及应用内菜单入口。
- 业务信息架构、Git 操作流程、面板位置和功能能力不因本次视觉改造而改变。

## 2. 目标

1. 让首屏窗口框架在 macOS 上立即呈现原生应用特征，包括左上角系统交通灯、系统菜单栏和符合 macOS 习惯的标题栏留白。
2. 将字体、间距、颜色、材质、控件、选中态、焦点态、菜单、对话框、滚动条和快捷键显示统一到 Xcode / Finder 风格。
3. 保持 Git 图谱、变更列表、差异查看器、终端和仓库中心等高密度工作区域可读，不使用大面积重玻璃或装饰性视觉。
4. 保持 Windows / Linux 现有行为不回退，所有 macOS 差异必须通过显式平台能力分支隔离。
5. 最终重新构建并验证正式 macOS arm64 DMG / ZIP；不生成 x64 包。

## 3. 非目标

- 不重排主工作区的信息架构，不改动 Git 业务语义和数据模型。
- 不把应用重写为 AppKit / SwiftUI；继续使用 Electron + React。
- 不照搬 Xcode 或 Finder 的图标、商标、专有资源，只复用系统平台行为与通用桌面设计语言。
- 不在本次工作中实现 Apple Developer ID 签名、公证或自动更新渠道迁移。当前 `mac.identity` 为 `null`，产物仍属于未签名包；这一限制必须在交付结论中明确说明。
- 不为了视觉统一而把状态绿、警告黄、错误红等 Git 语义色改为单一蓝色。

## 4. 当前实现证据

### 4.1 窗口框架

- `electron/main.ts` 的 `createWindow()` 对所有平台固定使用 `frame: false`。
- `src/components/AppChrome.tsx` 在窗口右侧绘制最小化、最大化/还原和关闭按钮。
- `electron/main.ts` 的 `configureApplicationMenu()` 当前执行 `Menu.setApplicationMenu(null)`。

### 4.2 视觉基础

- `src/styles/app.css` 的应用字体优先使用 `Segoe UI Variable Text`。
- 多处等宽字体直接使用 `Cascadia Code` 和 `Consolas`。
- `.app-window-controls` 使用 Windows 风格右上角三按钮布局，关闭按钮悬停为红色。
- `src/styles/liquid-glass.css` 已有大量主题和材质覆盖，因此本次应通过平台令牌和少量共享控件覆盖完成统一，避免继续堆叠不受控的全局透明效果。

### 4.3 菜单和快捷键

- 设置、主题和关于/更新入口位于应用内顶部栏。
- 默认快捷键配置主要使用 `Ctrl+...`，界面中的提交文案也显示 Windows 键位表达。
- 当前 preload 只暴露窗口状态、应用命令和业务 IPC，没有平台信息或原生菜单命令订阅。

## 5. 平台能力模型

### 5.1 平台来源

平台信息由主进程通过 preload 暴露，渲染层不得依赖 `navigator.userAgent` 猜测。

建议新增只读能力：

```ts
type DesktopPlatform = "macos" | "windows" | "linux" | "web";

type NativeMenuState = {
  themeMode: "system" | "light" | "dark";
  sidebarVisible: boolean;
  consoleVisible: boolean;
};

interface GitUIBridge {
  platform: DesktopPlatform;
  onMenuCommand(callback: (command: MenuCommand) => void): () => void;
  notifyMenuReady(): void;
  setNativeMenuState(state: NativeMenuState): Promise<void>;
}
```

- Electron 运行时由 `process.platform` 映射。
- 浏览器开发/Playwright 环境默认使用 `web`，并继续走现有非 macOS 分支，保持浏览器回归基线。
- 仅开发/测试构建允许在 React 初始化之前从 `window.__TEST_DESKTOP_PLATFORM__` 注入平台；生产构建必须忽略该字段，防止运行时页面伪造桌面能力。
- `App.tsx` 在根元素添加稳定类名：`platform-macos`、`platform-windows`、`platform-linux` 或 `platform-web`。
- 组件逻辑使用同一平台值，避免 CSS 和 React 分别猜测导致分支不一致。
- `App.tsx` 必须先注册 `onMenuCommand`，再调用 `notifyMenuReady()`；重复 ready 调用幂等，以兼容 React StrictMode。
- 主进程只接受当前有效窗口 `webContents` 发出的 ready 和 state 消息；窗口 reload、导航或销毁后旧 ready 状态立即失效。

### 5.2 平台隔离原则

- macOS 专用 CSS 必须以 `.platform-macos` 为根作用域。
- Windows / Linux 现有无边框窗口和窗口控制 IPC 保留。
- 通用视觉令牌可以补充，但不得直接改变其他平台已验证的尺寸或交互。
- 平台能力判断集中在小型 helper 或 bridge 类型中，不在各组件散落 `navigator.platform` 判断。

## 6. 原生窗口与标题栏

### 6.1 macOS BrowserWindow

macOS 使用以下窗口策略：

- 使用系统窗口框架和 `titleBarStyle: "hiddenInset"`。
- 保留原生交通灯，不在 React 中模拟红黄绿按钮。
- 使用 `trafficLightPosition` 调整交通灯到与 50px 工具栏垂直居中的位置，初始建议约为 `{ x: 14, y: 17 }`，最终以实机截图校准。
- 标题栏区域与渲染层顶部工具栏视觉融合，但主内容区保持不透明。
- 进入全屏时服从系统交通灯和工具栏行为，不手工覆盖全屏按钮。
- Windows / Linux 继续使用 `frame: false` 和当前窗口控制命令。

### 6.2 React 顶部栏

macOS 下 `AppChrome` 的结构调整为：

- 左侧预留至少 72px 的不可点击交通灯安全区。
- 安全区之后保留侧栏显隐按钮，使用 Lucide 的侧栏图标。
- 中部显示当前仓库名称；标题过长时单行省略，不挤压左右工具区。
- 不显示品牌图标、设置文字按钮、主题下拉、应用更新控件和 Windows 窗口控制按钮。
- 顶部栏可拖拽空白区域使用 `-webkit-app-region: drag`；所有按钮、输入和菜单触发器显式使用 `no-drag`。
- 无当前仓库时保持稳定高度，不因标题出现或消失产生布局跳动。

Windows / Linux 继续呈现现有品牌、应用内工具和右侧窗口控制按钮。

### 6.3 尺寸

- macOS 顶部工具栏目标高度：50px。
- 交通灯安全区宽度：72px；以 Electron 实机点击区域为准，不得覆盖交通灯。
- 工具栏图标按钮：28px 至 30px 固定正方形。
- 图标视觉尺寸：14px 至 16px。
- 分隔线：1px 物理感知边界，不使用粗描边或明显投影。

## 7. 原生 macOS 菜单

### 7.1 菜单结构

macOS 必须设置标准应用菜单，并使用系统角色提供平台一致的快捷键、翻译和系统行为：

1. `Git UI Pro`
   - 关于 Git UI Pro
   - 设置… (`CommandOrControl+,`)
   - 服务
   - 隐藏 Git UI Pro / 隐藏其他 / 全部显示
   - 退出 Git UI Pro
2. `文件`
   - 打开本地仓库… (`CommandOrControl+O`)
   - 克隆仓库…
   - 仓库中心…
   - 关闭窗口 (`CommandOrControl+W`)
3. `编辑`
   - 撤销、重做、剪切、复制、粘贴、全选，优先使用 Electron `role`
4. `视图`
   - 显示/隐藏项目侧栏
   - 显示/隐藏控制台
   - 明亮 / 黑暗 / 跟随系统
   - 重新载入（仅开发环境）
   - 切换全屏
5. `窗口`
   - 最小化、缩放、置前，使用系统 `role`
6. `帮助`
   - Git UI Pro 项目主页
   - Git UI Pro 版本历史

“项目主页”固定打开 `https://github.com/zjx150504-lgtm/Git_UI_Pro`，“版本历史”固定打开 `https://github.com/zjx150504-lgtm/Git_UI_Pro/releases`。两者由主进程通过现有 HTTPS 协议白名单和 `shell.openExternal` 处理，不进入 React 命令通道，也不依赖只支持 Windows 的更新服务。

Windows / Linux 继续禁用系统菜单，维持当前应用内入口。

### 7.2 菜单命令通道

原生菜单中直接由 Electron 完成的命令使用 `role`；需要改变 React 状态的命令通过单向事件发送给当前窗口：

```text
Menu click
  -> dispatchMenuCommand(command)
  -> ready window.webContents.send("app:menuCommand", command)
  -> preload.onMenuCommand(callback)
  -> App.tsx 统一命令分发器
  -> 现有状态更新或打开现有对话框
```

`MenuCommand` 使用封闭联合类型，至少覆盖：

- `preferences:open`
- `repository:open-local`
- `repository:clone`
- `repository:center`
- `sidebar:toggle`
- `console:toggle`
- `theme:system`
- `theme:light`
- `theme:dark`

约束：

- 不允许原生菜单自行复制仓库中心、主题或侧栏的业务逻辑。
- 订阅函数必须返回取消订阅回调，React effect 卸载时清理监听器。
- 菜单命令只允许白名单值；主进程和渲染层都使用共享类型或等价的穷尽检查。
- `preferences:open` 必须打开仓库中心并把初始页设为 `preferences`，不能复用当前顶部“设置”按钮的 `recovery/projects` 语义。
- `repository:open-local` 直接复用现有选择目录并添加仓库流程。
- `repository:clone` 打开仓库中心的项目页，并将焦点送入克隆仓库地址输入框；不得只打开一个无法定位操作入口的页面。
- `repository:center` 保留当前有选中项目时进入 `recovery`、无项目时进入 `projects` 的语义。
- 上述四个入口的测试必须断言最终可见页面和焦点/对话框状态，不能只断言 IPC 消息已发送。

### 7.3 菜单生命周期与就绪握手

macOS 关闭最后一个窗口后应用仍可能继续运行，菜单也可能在窗口创建或 React 监听器注册之前被点击。命令分发必须通过 `dispatchMenuCommand()` 管理生命周期：

1. 优先使用 `BrowserWindow.getFocusedWindow()`。
2. 否则使用尚未销毁的 `mainWindow`。
3. 没有可用窗口时创建新窗口，并将命令进入有界 FIFO 队列。
4. `did-finish-load` 只表示页面资源完成，仍需由 preload/renderer 发出 `app:menuReady` 握手；收到握手后再按顺序发送队列命令。
5. 窗口销毁时清除对应引用和就绪状态；未发送命令可转交下一窗口，队列必须设数量上限并按命令语义合并。
6. 任何发送前都检查 `webContents.isDestroyed()`，避免 macOS 重建窗口时抛出异常。

队列合并规则必须保持命令语义：

- `theme:*` 是 set 命令，只保留队列中的最后一个主题值。
- `sidebar:toggle` 和 `console:toggle` 按奇偶折叠：偶数次抵消，奇数次保留一次。
- `repository:*` 和 `preferences:open` 是一次性动作，严格保持 FIFO，不去重。
- 队列达到上限时拒绝新增一次性动作并记录可诊断日志，不静默丢弃已经入队的动作。

至少覆盖以下生命周期测试：

- 关闭最后一个窗口后，从系统菜单选择“打开本地仓库”，应用重建窗口并出现目录选择流程。
- 窗口启动过程中触发菜单，命令在 renderer ready 后只执行一次。
- 窗口销毁并重新激活后，菜单命令仍能驱动新窗口。
- 两次 toggle 抵消、三次 toggle 执行一次、多个主题命令只应用最后值、多个仓库动作保持原始顺序。

### 7.4 菜单状态同步

渲染层在初始化完成以及主题、侧栏、控制台状态变化后，通过受限 IPC 同步原生菜单状态：

状态通过前述 `setNativeMenuState(state: NativeMenuState)` bridge 方法提交。

- 主进程只接受完整、已校验的布尔值和主题联合类型，并更新对应 radio/check 菜单项。
- `ConfigStore` 初始化后、窗口创建前先读取主题偏好并设置 `nativeTheme.themeSource` 及匹配的窗口背景色，避免浅色模式先闪现硬编码深色背景。
- `readThemeMode()` 必须正确保留已保存的 `system`，`selectThemeMode()` 扩展为完整 `ThemeMode`，不得把跟随系统降级为浅色。
- 菜单重建后必须从最近一次状态恢复勾选值；没有 renderer 状态时使用 `ConfigStore` 默认偏好。
- 主进程监听 `nativeTheme` 的 `updated` 事件；仅当主题模式为 `system` 时重新计算所有有效窗口的 `backgroundColor`，显式 light/dark 不随系统切换。应用退出时清理监听器。

### 7.5 关于窗口与更新能力

macOS 的“关于 Git UI Pro”由原生应用菜单触发。优先使用 Electron `app.showAboutPanel()` 并配置版本、版权和说明；如 Electron 版本限制导致中文详情不可控，可保留原生 `dialog.showMessageBox`，但入口必须位于系统应用菜单。

“关于”完全由主进程处理，不进入 `MenuCommand`。当前更新安装和回退能力只支持已打包的 Windows，macOS 顶栏移除 `AppUpdateControl` 后采用以下明确的平台例外：

- 原生“关于”面板显示当前版本、版权和项目说明。
- “帮助”菜单的“版本历史”由主进程打开固定 GitHub Releases HTTPS 地址，不复用 `UpdateService.getReleaseHistory()`，因为该数据源当前只支持 Windows。
- macOS 不显示“检查更新”“安装更新”或“回退”命令，直到对应服务真正支持 macOS；不得提供点击后必然不支持的入口。
- Windows / Linux 保留当前 `AppUpdateControl` 和既有行为。

## 8. Xcode / Finder 视觉系统

### 8.1 设计原则

- 工作型而非展示型：优先扫描、比较和重复操作效率。
- 高密度但不拥挤：减少 Windows 式大按钮和厚重边框，保留明确点击面积。
- 层级来自材质、底色和细分隔线，不依赖嵌套卡片。
- 玻璃只用于标题栏、侧栏或浮层等系统材质区域；代码、差异、列表和终端保持稳定不透明背景。
- 选中和焦点使用系统蓝；Git 成功、警告、冲突和删除保留各自语义色。

### 8.2 字体

macOS 应用字体令牌：

```css
--system-font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif;
--display-font: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", sans-serif;
--mono-font: "SFMono-Regular", "SF Mono", Menlo, Monaco, monospace;
--app-font: var(--system-font);
```

字体变量分层为：

- `--system-font` 和 `--mono-font` 由平台根类提供。
- `--app-font` 只在用户偏好层引用 `var(--system-font)`、`var(--mono-font)` 或经过校验的自定义字体值。
- `App.tsx` 现有内联 `--app-font` 不能直接覆盖 macOS 系统字体令牌；实现时应改为设置字体模式变量或引用平台令牌。
- xterm 的 `fontFamily` 由平台 helper 返回实际字体字符串，不能依赖 xterm 未必稳定解析的 CSS 变量。

- 正文通常 12px 至 13px，工具栏和列表标题 11px 至 12px。
- 弹窗主标题 14px 至 16px，不使用营销式大标题。
- 字重以 400 / 500 / 600 为主；避免普遍使用 700。
- 字距保持 `0`，不使用负字距。
- 所有硬编码 Cascadia Code / Consolas 的工作区等宽字体应迁移到 `var(--mono-font)`。

### 8.3 颜色与材质

macOS 浅色模式建议令牌：

- 窗口底色：接近 `#f5f5f7`
- 主要内容底色：接近 `#ffffff`
- 侧栏底色：接近 `#eef0f3`，允许低强度背景材质
- 分隔线：接近 `rgba(60, 60, 67, 0.18)`
- 主文字：接近 `#1d1d1f`
- 次文字：接近 `#6e6e73`
- 选中蓝：接近系统蓝 `#0a84ff` / 浅色适配值

macOS 深色模式建议令牌：

- 窗口底色：接近 `#1e1e1e`
- 主要内容底色：接近 `#242424`
- 侧栏底色：接近 `#292a2d`
- 分隔线：接近 `rgba(255, 255, 255, 0.12)`
- 主文字：接近 `#f5f5f7`
- 次文字：接近 `#a1a1a6`
- 选中蓝：接近 `#0a84ff`

具体数值在实机截图中以 WCAG 对比度、代码可读性和现有 Git 语义色兼容性为准，不把整个界面染成蓝色或灰蓝色。

### 8.4 面板层级

- 项目侧栏：Finder 源列表式背景和紧凑行高；选中项使用圆角不超过 6px 的系统强调色或低强度 tint。
- 变更列表和 Git 图谱：保持不透明主工作面，使用细分隔线和一致行高，不包装成浮动卡片。
- 详情/差异区域：背景与代码层次明确，行号、增删色和选中态保持高对比度。
- 底部控制台：类似 Xcode Debug Area，顶栏与内容用细线分隔；终端仍使用适合终端的深色/浅色主题。
- 仓库中心：作为真正的工具对话框或全尺寸 sheet，不新增卡片套卡片。

### 8.5 通用控件

- 图标按钮：固定 28px 至 30px，边框默认透明，悬停使用低强度灰色 fill，按下态略深。
- 文本按钮：仅用于明确命令；主操作使用系统蓝或现有 Git 主色，危险操作使用系统红。
- 输入框：高度 28px 至 30px，圆角 5px 至 6px，细边框；焦点使用 2px 可见蓝色 focus ring。
- 分段控件：视图切换与模式选择使用 macOS segmented control 外观，尺寸稳定。
- 菜单：白/深色不透明高可读表面，6px 至 8px 圆角，紧凑菜单项和清晰勾选态。
- 对话框：圆角不超过 8px，减少厚重投影；标题、正文、操作区分层清楚。
- 滚动条：macOS 下采用窄、覆盖式观感；非悬停时弱化，悬停或滚动时增强，不占用稳定布局宽度。
- Tooltip：继续用于不熟悉的纯图标操作，并确保不被标题栏拖拽区域吞掉。

### 8.6 动效

- 仅保留 100ms 至 180ms 的悬停、菜单、侧栏和面板显隐过渡。
- 遵守 `prefers-reduced-motion`。
- 不使用弹跳、漂浮、缩放卡片或大面积背景动画。

### 8.7 全应用覆盖矩阵

“全应用”按下表验收；每个区域都要同时检查浅色/深色、常规/最小窗口，并覆盖适用的交互状态。

| 区域 | 必查内容 | 必查状态 |
| --- | --- | --- |
| 原生窗口与标题栏 | 交通灯、安全区、侧栏按钮、仓库标题、拖拽、全屏 | 默认、长标题、无仓库、窗口失焦 |
| 项目侧栏 | 分组、搜索、项目行、折叠态、底部工具 | hover、selected、favorite、disabled、empty |
| 工作区工具栏 | 拉取/推送/分支/筛选/视图切换 | hover、active、focus、disabled、loading |
| 变更与提交区 | 更改列表、提交输入、主按钮、提交菜单 | empty、dirty、staged、error、busy、focus |
| Git 图谱 | 提交行、分支标签、过滤器、上下文菜单 | selected、hover、loading、empty、error |
| Diff / 文件预览 | 标签页、行号、增删块、预览错误 | loading、binary、large file、error、focus |
| 控制台 | Debug Area 顶栏、标签、终端、尺寸拖拽 | open、closed、maximized、exited、error |
| 仓库中心 | 六个页签、左侧导航、表单、代码编辑器 | loading、empty、dirty、disabled、error |
| 弹层 | 远程仓库、分支/合并、确认弹窗、引用选择 | default、warning、danger、validation error |
| 浮层反馈 | 上下文菜单、浮动菜单、tooltip、toast | light、dark、keyboard focus、edge placement |

CSS 实现新增最后加载的 `src/styles/macos.css`，并在 `src/main.tsx` 中放在 `app.css`、`liquid-glass.css` 之后导入。该文件只允许以 `.platform-macos`（以及其主题子类）为根的规则，用来保证 Mac 覆盖不会被现有 liquid-glass 规则反向覆盖，也不会污染其他平台。

## 9. 快捷键与平台文案

- 菜单 accelerator 使用 Electron 的 `CommandOrControl`，macOS 自动呈现 Command 符号。
- 引入跨平台主修饰键 `Mod`：macOS 匹配 `Meta`，Windows/Linux 匹配 `Ctrl`。`Mod` 是存储和配置层的语义，不是把显式 `Ctrl` 在显示层偷换成 Command。
- 默认快捷键迁移为 `Mod+...`；现有用户配置中的显式 `Ctrl` 继续表示物理 Control，不自动改写，避免改变自定义行为。
- 解析、事件匹配、冲突校验和显示格式化共用同一个快捷键 helper，避免四套规则漂移。
- 渲染层可见快捷键使用平台格式化器；macOS 把 `Mod` 显示为 `⌘`，并显示 `⌥`、`⇧`、`⌃`；Windows/Linux 把 `Mod` 显示为 `Ctrl`。
- 提交和固定文件操作改用 `Mod+Enter`，macOS 实际由 `Meta+Enter` 触发，Windows/Linux 实际由 `Ctrl+Enter` 触发；提示文本与真实事件匹配必须使用相同 helper。
- 测试必须证明：Mac 的 `Command+Enter` 成功、Windows 的 `Ctrl+Enter` 成功、用户显式配置的 `Ctrl+Enter` 在 Mac 仍只响应 Control、不被错误迁移。

## 10. 可访问性与交互边界

- 所有图标按钮保留中文 `aria-label` 和 tooltip。
- 焦点态不能仅依赖颜色差异，必须有可见轮廓。
- 交通灯安全区不可放置任何可交互 DOM。
- 顶部栏所有控件明确 `no-drag`，空白区域才允许拖动窗口。
- 原生菜单触发的 React 对话框需要把焦点移入对话框，并在关闭后恢复合理焦点。
- 亮色和暗色下普通文字至少满足 4.5:1，对大文字/图标至少满足 3:1。
- 高对比度和减少动态效果作为 CSS 媒体查询覆盖，不影响 Windows / Linux 基础样式。

## 11. 实现边界与文件规划

预计修改以下模块，最终以实现计划为准：

- `electron/main.ts`：平台化 BrowserWindow、macOS 原生菜单、菜单命令发送、关于窗口。
- `electron/preload.ts`：只读平台信息和菜单命令订阅。
- `src/types/electron.d.ts`：bridge、平台和菜单命令类型。
- `src/App.tsx`：根平台类、原生菜单命令统一分发、菜单状态同步、完整主题模式和平台字体状态。
- `src/components/AppChrome.tsx`：macOS / 非 macOS 顶部栏分支。
- `src/components/WorkspaceView.tsx`：提交和固定文件的 `Mod+Enter` 行为及平台化提示。
- `src/components/ConsolePanel.tsx`：平台化 xterm 字体。
- `src/platform/desktop.ts` 或同等小型 helper：平台解析、快捷键匹配/格式化、系统字体解析。
- `src/styles/app.css`：通用变量收敛、macOS 字体和核心控件覆盖。
- `src/styles/liquid-glass.css`：限制 macOS 材质范围，协调现有主题覆盖。
- `src/styles/macos.css`：最后加载、严格作用域隔离的 macOS 全应用覆盖。
- `src/styles/repository-center.css`：仓库中心中无法由通用令牌覆盖的 Mac 工具窗口样式。
- `tests/ui/app-regression.spec.ts`：平台分支、标题栏几何、菜单事件和可见性回归。
- 新增或扩展 Electron/Node 测试脚本：验证窗口选项和原生菜单模板的纯函数配置。

禁止手工修改 `dist/`、`dist-electron/` 和 `release/` 生成文件。

## 12. 测试策略

### 12.1 先写失败测试

1. 提取可测试的窗口选项构造器，断言 macOS 使用 `hiddenInset` 且不禁用原生 frame，Windows / Linux 仍为无边框。
2. 提取可测试的 macOS 菜单模板，断言标准应用、编辑、视图和窗口角色存在，React 命令值来自白名单。
3. 为菜单排队、toggle 奇偶合并、renderer-ready 幂等握手、窗口重建和菜单状态校验编写 Node/Electron 配置层测试。
4. 为 preload bridge 类型、菜单订阅清理和 `setMenuState` 输入增加编译约束。
5. 更新 Playwright fixture：web 默认走 legacy 分支；macOS 用例通过 `addInitScript` 在 React 初始化前注入 `__TEST_DESKTOP_PLATFORM__ = "macos"`，生产代码路径忽略该字段。
6. 先断言 macOS 不显示 `.app-window-controls`、设置/主题/update 顶栏控件，并存在交通灯安全区和 `platform-macos` 根类。
7. 分别触发设置、打开本地仓库、克隆和仓库中心的模拟菜单事件，断言最终可见页面、焦点或系统调用代理，而不是只断言事件抵达；项目主页和版本历史由菜单模板/外链调用测试验证固定 URL。
8. 保留 Windows 平台断言，确保原有窗口控制仍可见和可点击。
9. 为 `Mod` 解析、显示、匹配和显式 `Ctrl` 兼容行为增加单元测试。

### 12.2 自动验证

- `npm run typecheck`
- 新增的窗口/菜单配置测试
- `npm run test:ui` 或受影响的 Playwright 精确用例
- `npm run build`
- `npm run test:macos`

全量 `npm test` 仍需执行；若本机远端仓库配置导致既有 release console 测试失败，应准确区分环境依赖失败与本次变更回归，不得宣称全量通过。

Playwright 只能证明渲染层平台分支和模拟菜单事件。系统菜单本身采用“纯菜单模板单测 + 命令生命周期单测 + 真实 Electron 点击烟雾测试”三层验证，并记录实际点击后出现的偏好页、主题类、侧栏、控制台和版本历史状态。

### 12.3 macOS 实机视觉验证

必须使用真实 Electron 窗口验证，浏览器截图不能代替：

1. 启动开发版或刚构建的 `.app`。
2. 至少采集浅色和深色两张主工作区截图。
3. 验证交通灯位置、标题居中、侧栏按钮点击区、拖拽区域和全屏切换。
4. 打开仓库中心、主题菜单/系统菜单、Git 操作菜单、确认对话框和控制台，检查无遮挡、文字截断和卡片嵌套问题。
5. 在不低于 1280×800 和接近最小窗口 860×640 的尺寸检查布局。
6. 用截图与 Xcode / Finder 方向逐项比较，至少完成一轮视觉修正。
7. 在应用不重启的情况下切换 macOS 系统浅色/深色外观，确认标题栏、窗口背景和 renderer 同步变化。

### 12.4 正式 arm64 交付验证

- 构建前创建或清理一个仅用于本次任务的明确暂存输出目录，不使用含历史产物的 `release/` 列表直接下结论。
- 执行 `npm run dist:mac -- --publish never`，将本次输出指向该暂存目录或在构建后按构建时间和校验值建立精确清单。
- 确认只生成 arm64 DMG / ZIP，不出现 x64 或 universal 产物。
- 最终清单只允许一个 arm64 DMG、一个 arm64 ZIP 和对应 `mac-arm64` 应用目录；额外 x64/universal 文件视为失败。
- 使用 `file` / `lipo -info` 验证主可执行文件和关键原生模块为 arm64。
- 使用 `hdiutil verify` 验证 DMG，使用 `unzip -t` 验证 ZIP。
- 对打包 `.app` 做启动烟雾测试并确认原生菜单、交通灯和首屏渲染。
- 明确报告签名/公证状态；未配置证书时不能称为已签名或可直接通过 Gatekeeper 分发的正式发布包。

## 13. 验收标准

1. macOS 首屏不再出现右上角 Windows 窗口控制按钮，左上角显示可用的系统交通灯。
2. macOS 系统菜单栏包含标准应用、文件、编辑、视图、窗口和帮助菜单，设置、主题、侧栏等命令能真实改变应用状态。
3. macOS 顶部栏不再显示“设置”“主题”和 Windows 更新入口；对应能力迁移到原生菜单或仓库中心。
4. 应用字体、等宽字体、选中态、焦点态、按钮、输入框、菜单、弹窗和滚动条在主要工作流中保持一致的 Mac 工具应用风格。
5. 主工作区、Git 图谱、Diff 和终端没有因材质透明度导致的可读性下降。
6. 在最小窗口和常规窗口下无明显遮挡、溢出、标题挤压或点击区域错位。
7. Windows / Linux 的现有自绘窗口控制和应用内入口保持可用。
8. 类型检查、构建、受影响测试和 macOS 视觉验证通过；任何既有环境依赖测试失败被单独披露。
9. 最终产物仅包含 macOS arm64 DMG / ZIP，并完成架构与完整性验证。

## 14. 风险与控制

- **拖拽区吞掉按钮点击**：通过明确 `drag` / `no-drag` 规则和 Electron 实机点击测试控制。
- **交通灯与侧栏按钮重叠**：使用固定安全区并在全屏、缩放、浅色/深色下截图校准。
- **原生菜单与 React 状态不同步**：集中命令分发，主题状态需要显式同步或不显示错误勾选。
- **无窗口或未就绪时菜单命令丢失**：通过有界命令队列、renderer-ready 握手和窗口重建测试控制。
- **快捷键只改文案不改行为**：引入共享 `Mod` 语义，并为物理 Ctrl/Meta 兼容分别测试。
- **全局 CSS 覆盖 Windows**：所有 macOS 视觉差异根作用域隔离，并保留 Windows Playwright 回归。
- **现有 liquid-glass 规则优先级冲突**：减少新增选择器层级，优先收敛变量；对必要组件做定向覆盖并通过截图检查。
- **仅浏览器验证掩盖原生窗口问题**：把真实 Electron 窗口截图和交互列为硬验收项。
- **未签名包被误称正式可发布**：将“正式包”拆分为 release 构建质量与 Apple 签名/公证两个状态，交付时分别报告。
