# Git UI Pro 分支路径树与菜单高亮设计

日期：2026-08-28  
状态：已根据用户截图确认方向；沿用“无需二次确认，文档完成后直接实现”的执行约束  
目标平台：macOS arm64，行为保持跨平台可用

## 1. 背景

当前分支栏把所有本地和远程分支显示为平铺列表。仓库存在大量 `kirin/...`、`feature/...` 或 `origin/feature/...` 分支时，相同前缀被重复显示，扫描成本高，也无法折叠暂时不关注的分支族。

分支右键菜单还存在独立的样式作用域问题：`BranchRail` 把菜单 portal 到 `document.body`，菜单脱离 `.platform-macos`，无法继承 macOS 主题令牌。高亮项因此使用根主题的浅色或透明背景，白色文字难以辨认；禁用菜单项 hover 后也可能被错误绘制成蓝色高亮。

## 2. 目标

1. “本地分支”和“远程分支”内按分支名中的 `/` 构建可递归折叠的路径树。
2. 路径前缀只显示一次，并使用 Finder 式文件夹行、展开箭头和后代分支数量。
3. 叶子节点仍代表原始完整 Git 分支，所有切换、合并、变基、重命名、删除、拉取和推送行为保持不变。
4. 搜索分支时自动展开匹配路径；清空搜索后恢复用户此前的折叠状态。
5. 修复 macOS 分支菜单高亮与禁用态，使可选项为清晰蓝底白字，禁用项保持灰态。

## 3. 非目标

- 不修改 Git refs、分支排序来源或远程解析逻辑。
- 不引入第三方 TreeView、虚拟列表或新的状态管理依赖。
- 不在本次增加拖拽移动分支、批量分支操作或分支收藏。
- 不把路径文件夹当成真实 Git 对象；文件夹行只负责展开和收起。

## 4. 方案比较

### 4.1 仅按第一个 `/` 做一级分组

实现最简单，但 `feature/mobile/login` 仍会在第二层重复路径，不能满足“按 `/`”的完整语义。后续增加多级支持还需要重写。

### 4.2 递归路径树（采用）

把每个分支名拆成路径段，以稳定的完整路径作为文件夹 key，递归生成文件夹和叶子节点。支持任意深度，数据量与现有分支数量线性相关，不引入依赖，最符合 Finder/Xcode 导航习惯。

### 4.3 引入通用 TreeView 库

可以获得完整 tree 键盘模型和虚拟化，但会引入新的样式、焦点和依赖边界；当前分支栏规模和交互不需要这层复杂度。

## 5. 数据结构

`BranchRail.tsx` 内增加纯函数 `buildBranchPathTree()`，输入已筛选且已区分 local/remote 的 `BranchRailItem[]`，输出两类节点：

```ts
type BranchPathNode = BranchPathFolder | BranchPathLeaf;

interface BranchPathFolder {
  kind: "folder";
  key: string;
  label: string;
  branchCount: number;
  children: BranchPathNode[];
}

interface BranchPathLeaf {
  kind: "branch";
  key: string;
  label: string;
  branch: BranchRailItem;
}
```

- `key` 包含 local/remote 作用域与完整前缀，避免本地和远程同名路径冲突。
- `label` 只显示当前路径段；叶子仍保留 `branch.name` 和 `branch.fullName`。
- 节点遵循 Git 服务返回的首次出现顺序，不额外改变分支排序。
- 不含 `/` 的分支仍直接显示为叶子。

## 6. 交互设计

### 6.1 文件夹

- 文件夹行使用 Lucide `Folder`/`FolderOpen` 和 `ChevronDown`。
- 行尾显示该路径下的叶子分支总数。
- 点击文件夹行切换 `aria-expanded`；文件夹本身没有 Git 右键菜单。
- 所有文件夹默认展开，以保持现有分支可见性；用户主动折叠后，在当前项目和本次组件生命周期内保持状态。
- 切换项目时通过 React `key` 重建 `BranchRail`，避免不同仓库复用相同路径的折叠状态。
- `App.tsx` 使用 `key={selectedProject?.id ?? "no-project"}`；切换到任意其他项目再切回时也创建新组件，不恢复旧项目的临时搜索、选中和折叠状态。

### 6.2 叶子分支

- 主标题显示最后一个路径段，例如 `kirin/20260318-ice` 显示为文件夹 `kirin` 下的 `20260318-ice`。
- `data-branch-name`、菜单 aria-label、双击切换和所有操作继续使用完整分支名。
- 当前分支、upstream、ahead/behind、选中态和 busy 状态保持现有语义。
- 根据树深度增加稳定缩进，但右侧省略号菜单保持在固定列，不随文字长度漂移。

### 6.3 搜索

- 继续先用完整分支名和 upstream 过滤叶子，再根据结果构建树。
- 查询非空时，所有包含匹配叶子的祖先文件夹强制展开。
- 查询非空时，有匹配结果的“本地分支”或“远程分支”顶层组也临时强制展开，即使用户此前收起了该组。
- 搜索不会修改用户保存的折叠集合；清空查询后恢复搜索前的折叠状态。
- 搜索期间点击顶层组或路径文件夹不修改保存状态，控件以 `aria-disabled="true"` 表达暂时不可折叠；清空查询后恢复原有 `localOpen`、`remoteOpen` 和路径折叠集合。
- 没有匹配项时保留本地/远程组标题和 `0` 计数，不显示空文件夹。

## 7. 菜单样式

- 分支菜单 portal 到 `.app-shell`，与项目菜单和路径提示框使用同一平台/主题作用域。
- macOS 可用菜单项 hover 使用 `--accent: #0a84ff` 和白色文字。
- macOS 菜单 hover 规则必须带 `:not(:disabled)`；禁用项保持透明背景、主题文字色和既有透明度。
- 键盘焦点、Escape 关闭和触发按钮焦点恢复行为保持不变。

## 8. 无障碍和布局

- 文件夹行使用原生 `button` 与 `aria-expanded`，可通过 Tab 和 Space/Enter 操作。
- 文件夹按钮使用稳定 `aria-controls` 关联子级容器；嵌套内容使用对应 `id`、`role="group"` 和稳定 `aria-label`。叶子按钮和菜单仍使用现有可访问名称。
- Space/Enter 展开或折叠后焦点保留在同一文件夹按钮；搜索期间按钮带 `aria-disabled="true"`，不改变保存状态。
- 缩进通过 CSS 自定义属性 `--branch-depth` 计算，每级固定 14px；不使用视口宽度缩放字体。
- 文件夹名和分支名过长时单行省略，不覆盖计数、ahead/behind 或省略号按钮。

## 9. 验证标准

1. Playwright 先证明当前 macOS 菜单高亮测试失败，再证明 portal 修复后为系统蓝；禁用态测试同样完成 RED→GREEN。
2. Playwright 增加本地与远程多级路径、折叠/展开、完整分支操作和搜索临时展开测试。
3. 测试夹具包含本地与远程同名显示路径，证明折叠 key 的 local/remote 作用域互不影响；项目切换测试证明组件临时状态重置。
4. 交互测试沿用现有 Playwright 的 `window.gitUI` 测试桥模式，把分支方法替换为记录参数的 spy；完成确认流程后直接断言 `switchBranch` 收到原始 `BranchRailItem`，merge/rebase/rename/local delete 收到完整本地分支名，fetch 收到正确 remoteName，remote delete 分别收到正确 remoteName 与 remoteBranchName。通知和对话框标题只作为附加用户反馈断言，不能替代底层参数断言。
5. 对当前多级分支验证 fetch/pull/push/create 的菜单可用/禁用语义及实际 bridge 调用，确保树化不改变当前分支操作。
6. `npm run typecheck` 和完整 `npm run test:ui` 通过。
7. `npm test` 如仍只有现有 Gitee remote 前置条件失败，必须明确记录，不得宣称聚合测试全绿。
8. 重新执行 `make install MACOS_OUTPUT_DIR=release-arm64`，验证 DMG、ZIP、应用与原生模块全部为 arm64，并重新启动 `/Applications/Git UI Pro.app`。
