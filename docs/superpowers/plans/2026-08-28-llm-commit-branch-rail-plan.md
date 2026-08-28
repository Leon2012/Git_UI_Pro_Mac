# LLM Commit Message and Branch Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Git UI Pro 增加安全的 OpenAI 兼容提交消息生成、独立分支栏和完整分支上下文操作。

**Architecture:** Electron 主进程新增 LLM 服务，独立管理加密配置、Git diff 上下文和 Chat Completions 请求；渲染进程只通过受限 IPC 获取配置摘要与生成结果。分支栏复用现有 GitService 能力，由 App 统一协调操作、刷新和反馈，偏好设置沿用 RepositoryCenter 的页面边界。

**Tech Stack:** Electron 29、TypeScript strict、React 18、Lucide React、Sonner、Node test runner、Playwright。

---

## 文件结构

- Create: `electron/llmService.ts` - LLM 配置、加密凭据、URL 校验、请求和提交消息解析。
- Modify: `electron/gitService.ts` - 提供与提交语义一致的、限长且脱敏的 LLM diff 上下文。
- Modify: `electron/main.ts` - 初始化 LLM 服务并注册受限 IPC。
- Modify: `electron/preload.ts` - 暴露 LLM 配置、测试和生成方法。
- Modify: `src/types/domain.ts`、`src/types/electron.d.ts` - 共享 LLM 类型和 bridge 契约。
- Modify: `src/api/client.ts` - Electron 调用和浏览器测试 mock。
- Create: `src/components/BranchRail.tsx` - 分支列表、搜索、选择和上下文菜单。
- Modify: `src/App.tsx` - 分支栏布局、数据刷新、操作编排、LLM 偏好入口和生成回调。
- Modify: `src/components/WorkspaceView.tsx` - 生成按钮、busy 状态和草稿替换确认。
- Modify: `src/components/RepositoryCenter.tsx`、`src/components/RepositoryCenterContainer.tsx` - LLM 偏好表单、保存/测试/清除状态。
- Modify: `src/styles/app.css`、`src/styles/macos.css`、`src/styles/repository-center.css` - 分支栏、生成按钮和 macOS 偏好样式。
- Create: `scripts/test-llm-service.mjs` - 主进程 LLM 单元测试。
- Modify: `scripts/test-config-store.mjs` 或新增服务测试夹具 - 配置持久化契约。
- Modify: `tests/ui/app-regression.spec.ts` - 分支栏和 LLM UI 回归。
- Modify: `package.json` - 增加 LLM 测试命令并纳入总测试。

### Task 1: LLM 纯函数契约与安全配置服务

- [x] 在 `scripts/test-llm-service.mjs` 编写失败测试：HTTPS、localhost/RFC1918 HTTP 允许，公网 HTTP 和非 HTTP(S) 协议拒绝。
- [x] 运行 `npm run build:electron && node --test scripts/test-llm-service.mjs`，确认因模块或导出缺失而失败。
- [x] 在 `electron/llmService.ts` 实现 Base URL 规范化、Chat Completions 端点拼接和 HTTP 私网判断，使 URL 测试通过。
- [x] 增加失败测试：Markdown/引号清理、英文 Conventional Commit 校验、多行说明拒绝。
- [x] 实现提交标题清理与校验，使测试通过。
- [x] 增加失败测试：安全配置首次保存、空 Key 保留、显式清除、无法加密时拒绝保存 Key；通过依赖注入隔离 `safeStorage`。
- [x] 实现原子写入的独立安全配置文件，并确保公开摘要只返回 `baseUrl`、`model`、`apiKeyConfigured`、`insecurePrivateHttp`。
- [x] 运行 LLM 服务测试并完成检查点，不提交代码。

### Task 2: 与提交语义一致的 Git 上下文

- [x] 在 `scripts/test-llm-service.mjs` 或独立 Git 测试中编写失败测试：有 staged 时只选 staged；无 staged 时选择 unstaged/untracked。
- [x] 在 `electron/gitService.ts` 新增 `getCommitMessageContext()`，使用 Git 命令获得 staged 或工作区 patch；未跟踪文件先 `lstat`，普通文本限长读取，符号链接只读取 link target 而不跟随，FIFO/socket/device 等非常规文件和二进制只保留相对路径与类型元数据。
- [x] 增加失败测试：64 KiB 截断、仓库相对路径、Authorization/token/password/私钥片段脱敏。
- [x] 实现可独立测试的上下文裁剪和脱敏 helper；将上下文来源和截断状态写入返回结构。
- [x] 运行上下文测试和现有 Git merge/service 测试，完成检查点。

### Task 3: Chat Completions 请求和 IPC 边界

- [x] 编写失败测试：请求方法、Authorization、model、messages、45 秒超时、响应大小上限、非 2xx 和畸形 choices 错误。
- [x] 定义 `LlmConnectionTestInput`，携带当前表单未保存的 `baseUrl`、`model` 和可选新 `apiKey`；在 `LlmService` 中以可注入 fetch 实现不落盘的 `testConnection(input)` 和使用已保存配置的 `generateCommitMessage()`，任何错误不得泄漏 Key 或完整 diff。
- [x] 在 `electron/main.ts` 注册 `llm:getSettings`、`llm:saveSettings`、`llm:clearApiKey`、`llm:testConnection`、`llm:generateCommitMessage`，生成时由主进程调用 GitService 获取上下文。
- [x] 更新 preload、domain、electron 声明和 apiClient，完整透传临时测试输入且不触发保存；浏览器 mock 返回稳定配置与示例 Conventional Commit。
- [x] 运行 LLM 测试与 `npm run typecheck`，完成检查点。

### Task 4: 偏好设置中的 LLM 配置

- [x] 在 `tests/ui/app-regression.spec.ts` 增加失败断言：偏好设置可见 LLM 区、三个字段、已配置状态、保存/测试/清除按钮和私网 HTTP 警告。
- [x] 扩展 `RepositoryCenter` 数据与 actions 契约，新增紧凑的 LLM 配置区；API Key 不回填，空值保存保留原 Key。
- [x] 在 `RepositoryCenterContainer` 加载配置摘要，并实现独立保存、测试连接、清除 Key 的 busy/error/success 状态；测试连接直接提交当前表单的未保存 Base URL、Model 和新 Key，成功后保持表单脏状态且不落盘。
- [x] 支持从提交区以 `preferences` 初始页打开后聚焦 LLM 区。
- [x] 运行目标 Playwright 用例和 typecheck，完成检查点。

### Task 5: 独立分支栏基础 UI

- [x] 在 Playwright 中编写失败断言：项目栏之后出现“分支”栏，本地/远程分组、当前分支、搜索、刷新、创建和折叠控件可见。
- [x] 新建 `BranchRail.tsx`，实现 loading/empty/error、分组、搜索、选择、双击切换、右键与省略号共用菜单。
- [x] 在 `App.tsx` 加载并缓存当前项目分支；项目切换和 Git 操作完成后刷新。
- [x] 在 App 外层布局加入分支栏、拖动调整宽度与折叠状态；窄窗口自动折叠，固定控件尺寸避免布局跳动。
- [x] 在 CSS 中实现 Xcode/Finder 式紧凑列表、macOS 选中态、ahead/behind 徽标和响应式规则。
- [x] 运行目标 Playwright 用例并截取桌面/窄窗口截图，完成检查点。

### Task 6: 动态分支操作菜单

- [x] 编写失败 UI 测试：当前本地、其他本地、远程分支显示不同菜单项，禁用规则正确。
- [x] 定义 `BranchAction` 联合类型和纯函数菜单模型，避免 UI 内散落权限判断；给远程分支视图模型增加结构化 `remoteName` 与 `remoteBranchName`，通过当前 `getRemotes()` 返回值做最长远端名前缀匹配，正确支持分支名中的 `/`。
- [x] 在 App 复用现有 fetch/pull/push/create/switch/merge/rebase/rename/delete/upstream API；扩展现有 `BranchDialog` 的 rename 模式收集并校验 `nextName`，不使用 prompt 或字符串猜测远端。
- [x] 合并、rebase、删除等风险操作走已有确认偏好；每个操作显示 busy，成功后刷新 status、worktree、branches、history，失败显示明确 toast/操作反馈。
- [x] 运行分支 UI 测试、现有 repository capabilities 和 merge 测试，完成检查点。

### Task 7: 提交区 LLM 生成交互

- [x] 编写失败 UI 测试：提交输入旁有 Sparkles 图标按钮；配置缺失打开 LLM 偏好；已有草稿要求确认；生成中禁用；成功替换草稿。
- [x] 扩展 `WorkspaceView` props，加入生成回调并通过 App 打开 LLM 偏好；保持每项目草稿隔离。
- [x] 实现确认替换、loading、错误反馈和键盘可访问提示；不在渲染进程拼装或传输 diff。
- [x] 在 `App.tsx` 连接 API，生成成功后只更新当前项目草稿，不自动提交。
- [x] 运行目标 Playwright 用例和 typecheck，完成检查点。

### Task 8: 全量验证和 macOS 实机检查

- [x] 将 `test:llm` 加入 `package.json` 并纳入现有 `npm test` 聚合命令，运行 `npm run test:llm`。
- [x] 运行 `npm run typecheck` 和 `npm run build`。
- [x] 运行相关 Node 测试；`npm test` 的核心 Node 测试 98 项、merge 测试及 release-console 36 项通过，仍有 1 个既有 `发布控制台仅凭令牌返回仓库状态` 用例因当前远端无 Gitee 配置而失败（`scripts/test-release-console.mjs:972` 的 `provider` 读取空值），不归因于本功能。
- [x] 运行 `npm run test:ui`，新增 LLM、分支栏、分支搜索、窄窗口、右侧拖拽、键盘菜单和偏好设置层级用例及现有回归共 41 项全部通过。
- [x] 启动 Electron/macOS arm64 构建，实机验证分支栏、提交生成、偏好设置、标题栏和窗口缩放；截图保存在 `test-results/llm-branch-ui/`，原生界面 smoke 通过。
- [x] 运行 `make install MACOS_OUTPUT_DIR=release-arm64` 和 arm64 产物验证脚本；DMG、ZIP、应用主程序及原生模块均为 arm64，不包含 x64/universal，并已签名安装到 `/Applications/Git UI Pro.app`。
- [x] 更新本 plan 的复选框和验证结果；未执行 `git commit` 或 `git push`。
