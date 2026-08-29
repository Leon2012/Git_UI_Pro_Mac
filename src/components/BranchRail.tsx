import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronLeft, ChevronRight, CloudDownload, CloudUpload, Folder, FolderOpen, GitBranch, GitBranchPlus, MoreHorizontal, RefreshCw, Search } from "lucide-react";
import type { BranchInfo, GitRemoteInfo } from "../types/domain";
import { PathTooltip } from "./PathTooltip";

export type BranchAction =
  | "fetch"
  | "pull"
  | "push"
  | "create"
  | "switch"
  | "merge-into-current"
  | "rebase-onto"
  | "rename"
  | "delete-local"
  | "fetch-remote"
  | "track-remote"
  | "delete-remote";

export interface BranchRailItem extends BranchInfo {
  remoteName?: string;
  remoteBranchName?: string;
}

interface BranchRailProps {
  branches: BranchRailItem[];
  loading: boolean;
  error?: string;
  collapsed: boolean;
  busyAction?: string;
  onToggleCollapsed: () => void;
  onRefresh: () => void;
  onAction: (action: BranchAction, branch?: BranchRailItem) => void | Promise<void>;
}

interface BranchMenuState {
  branch: BranchRailItem;
  top: number;
  left: number;
  trigger: HTMLButtonElement | null;
}

interface BranchMenuItem {
  action: BranchAction;
  label: string;
  danger?: boolean;
  disabled?: boolean;
}

type BranchPathScope = "local" | "remote";

export interface BranchPathFolder {
  kind: "folder";
  key: string;
  label: string;
  path: string;
  branchCount: number;
  children: BranchPathNode[];
}

export interface BranchPathLeaf {
  kind: "branch";
  key: string;
  label: string;
  branch: BranchRailItem;
}

export type BranchPathNode = BranchPathFolder | BranchPathLeaf;

interface BranchPathBuildLevel {
  children: BranchPathNode[];
  folders: Map<string, BranchPathBuildFolder>;
}

interface BranchPathBuildFolder {
  node: BranchPathFolder;
  level: BranchPathBuildLevel;
}

export function buildBranchPathTree(branches: BranchRailItem[], scope: BranchPathScope): BranchPathNode[] {
  const root: BranchPathBuildLevel = { children: [], folders: new Map() };
  for (const branch of branches) {
    const segments = branch.name.split("/").filter(Boolean);
    if (segments.length === 0) {
      root.children.push({ kind: "branch", key: `${scope}:branch:${branch.fullName}`, label: branch.name, branch });
      continue;
    }

    let level = root;
    const path: string[] = [];
    for (const segment of segments.slice(0, -1)) {
      path.push(segment);
      let folder = level.folders.get(segment);
      if (!folder) {
        const node: BranchPathFolder = {
          kind: "folder",
          key: `${scope}:folder:${path.join("/")}`,
          label: segment,
          path: path.join("/"),
          branchCount: 0,
          children: []
        };
        folder = { node, level: { children: node.children, folders: new Map() } };
        level.folders.set(segment, folder);
        level.children.push(node);
      }
      folder.node.branchCount += 1;
      level = folder.level;
    }

    level.children.push({
      kind: "branch",
      key: `${scope}:branch:${branch.fullName}`,
      label: segments.at(-1) ?? branch.name,
      branch
    });
  }
  return root.children;
}

export function resolveBranchRailItems(branches: BranchInfo[], remotes: GitRemoteInfo[]): BranchRailItem[] {
  const remoteNames = remotes.map((remote) => remote.name).sort((left, right) => right.length - left.length);
  return branches.map((branch) => {
    if (branch.type !== "remote") {
      return branch;
    }
    const remoteName = remoteNames.find((name) => branch.name.startsWith(`${name}/`));
    return {
      ...branch,
      remoteName,
      remoteBranchName: remoteName ? branch.name.slice(remoteName.length + 1) : undefined
    };
  });
}

export function branchMenuItems(branch: BranchRailItem): BranchMenuItem[] {
  if (branch.current) {
    return [
      { action: "fetch", label: "获取" },
      { action: "pull", label: "拉取", disabled: !branch.upstream },
      { action: "push", label: "推送" },
      { action: "create", label: "新建分支" }
    ];
  }
  if (branch.type === "local") {
    return [
      { action: "switch", label: "切换到此分支" },
      { action: "merge-into-current", label: "合并到当前分支" },
      { action: "rebase-onto", label: "变基到此分支" },
      { action: "rename", label: "重命名" },
      { action: "delete-local", label: "删除本地分支", danger: true }
    ];
  }
  return [
    { action: "track-remote", label: "创建跟踪分支", disabled: !branch.remoteName },
    { action: "fetch-remote", label: `获取 ${branch.remoteName ?? "远端"}`, disabled: !branch.remoteName },
    { action: "merge-into-current", label: "合并到当前分支" },
    { action: "delete-remote", label: "删除远程分支", danger: true, disabled: !branch.remoteName || !branch.remoteBranchName }
  ];
}

export function BranchRail({
  branches,
  loading,
  error,
  collapsed,
  busyAction,
  onToggleCollapsed,
  onRefresh,
  onAction
}: BranchRailProps) {
  const [query, setQuery] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [localOpen, setLocalOpen] = useState(true);
  const [remoteOpen, setRemoteOpen] = useState(true);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<BranchMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleBranches = useMemo(() => branches.filter((branch) => !normalizedQuery
    || `${branch.name} ${branch.upstream ?? ""}`.toLocaleLowerCase().includes(normalizedQuery)), [branches, normalizedQuery]);
  const localBranches = visibleBranches.filter((branch) => branch.type === "local");
  const remoteBranches = visibleBranches.filter((branch) => branch.type === "remote");
  const localTree = useMemo(() => buildBranchPathTree(localBranches, "local"), [localBranches]);
  const remoteTree = useMemo(() => buildBranchPathTree(remoteBranches, "remote"), [remoteBranches]);
  const searchActive = normalizedQuery.length > 0;
  const toolbarBranch = branches.find((branch) => branch.fullName === selectedBranch)
    ?? branches.find((branch) => branch.current);
  const toolbarBranchLabel = toolbarBranch?.name ?? "当前分支";
  const toolbarBusy = Boolean(busyAction);
  const toolbarUsesCurrentLocalBranch = toolbarBranch?.type === "local" && toolbarBranch.current;

  function toggleFolder(key: string) {
    if (searchActive) return;
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    });
    document.addEventListener("pointerdown", close);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", close);
    };
  }, [menu]);

  function openMenu(branch: BranchRailItem, event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const width = 210;
    const height = branchMenuItems(branch).length * 32 + 12;
    setSelectedBranch(branch.fullName);
    setMenu({
      branch,
      top: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      trigger: event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null
    });
  }

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!menu) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setMenu(null);
      menu.trigger?.focus();
      return;
    }
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    if (items.length === 0) return;
    const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (currentIndex + 1) % items.length
          : event.key === "ArrowUp"
            ? (currentIndex - 1 + items.length) % items.length
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    items[nextIndex].focus();
  }

  if (collapsed) {
    return (
      <aside className="branch-rail collapsed" aria-label="分支">
        <PathTooltip content="展开分支栏">
          <button type="button" className="branch-rail-expand" aria-label="展开分支栏" onClick={onToggleCollapsed}>
            <GitBranch size={16} />
            <ChevronRight size={14} />
          </button>
        </PathTooltip>
      </aside>
    );
  }

  return (
    <aside className="branch-rail" aria-label="分支">
      <header className="branch-rail-header">
        <span className="branch-rail-title"><GitBranch size={16} /><h2>分支</h2><small>{branches.length}</small></span>
        <span className="branch-rail-actions">
          <PathTooltip content={`获取 ${toolbarBranchLabel}`}>
            <button type="button" aria-label={`获取 ${toolbarBranchLabel}`} onClick={() => void onAction("fetch", toolbarBranch)} disabled={!toolbarBranch || loading || toolbarBusy}><RefreshCw size={14} className={busyAction?.startsWith("fetch") ? "spin" : ""} /></button>
          </PathTooltip>
          <PathTooltip content={`拉取 ${toolbarBranchLabel}`}>
            <button type="button" aria-label={`拉取 ${toolbarBranchLabel}`} onClick={() => void onAction("pull", toolbarBranch)} disabled={!toolbarUsesCurrentLocalBranch || !toolbarBranch?.upstream || toolbarBusy}><CloudDownload size={14} /></button>
          </PathTooltip>
          <PathTooltip content={`推送 ${toolbarBranchLabel}`}>
            <button type="button" aria-label={`推送 ${toolbarBranchLabel}`} onClick={() => void onAction("push", toolbarBranch)} disabled={!toolbarUsesCurrentLocalBranch || toolbarBusy}><CloudUpload size={14} /></button>
          </PathTooltip>
          <PathTooltip content={`从 ${toolbarBranchLabel} 新建分支`}>
            <button type="button" aria-label={`从 ${toolbarBranchLabel} 新建分支`} onClick={() => void onAction("create", toolbarBranch)} disabled={!toolbarBranch || toolbarBusy}><GitBranchPlus size={14} /></button>
          </PathTooltip>
          <span className="branch-rail-action-separator" aria-hidden="true" />
          <PathTooltip content="收起分支栏">
            <button type="button" aria-label="收起分支栏" onClick={onToggleCollapsed}><ChevronLeft size={15} /></button>
          </PathTooltip>
        </span>
      </header>
      <label className="branch-rail-search">
        <Search size={14} />
        <input type="search" aria-label="搜索分支" placeholder="搜索分支" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="branch-rail-list">
        {error ? <div className="branch-rail-message error"><span>{error}</span><button type="button" onClick={onRefresh}>重试</button></div> : null}
        {!error && loading && branches.length === 0 ? <div className="branch-rail-message">正在读取分支...</div> : null}
        {!error && !loading && branches.length === 0 ? <div className="branch-rail-message">当前仓库没有可显示的分支。</div> : null}
        <BranchGroup title="本地分支" count={localBranches.length} open={searchActive && localBranches.length > 0 ? true : localOpen} toggleDisabled={searchActive} onToggle={() => setLocalOpen((value) => !value)}>
          <BranchPathTree scope="local" nodes={localTree} depth={0} collapsedFolders={collapsedFolders} forceExpanded={searchActive} selectedBranch={selectedBranch} busy={Boolean(busyAction)} onToggleFolder={toggleFolder} onSelect={setSelectedBranch} onOpenMenu={openMenu} onAction={onAction} />
        </BranchGroup>
        <BranchGroup title="远程分支" count={remoteBranches.length} open={searchActive && remoteBranches.length > 0 ? true : remoteOpen} toggleDisabled={searchActive} onToggle={() => setRemoteOpen((value) => !value)}>
          <BranchPathTree scope="remote" nodes={remoteTree} depth={0} collapsedFolders={collapsedFolders} forceExpanded={searchActive} selectedBranch={selectedBranch} busy={Boolean(busyAction)} onToggleFolder={toggleFolder} onSelect={setSelectedBranch} onOpenMenu={openMenu} onAction={onAction} />
        </BranchGroup>
      </div>
      {menu && typeof document !== "undefined" ? createPortal(
        <div className="branch-context-menu floating-menu" role="menu" aria-label="分支操作" ref={menuRef} style={{ top: menu.top, left: menu.left }} onKeyDown={handleMenuKeyDown}>
          {branchMenuItems(menu.branch).map((item) => (
            <button
              key={item.action}
              type="button"
              role="menuitem"
              className={item.danger ? "danger" : ""}
              disabled={item.disabled || Boolean(busyAction)}
              onClick={() => {
                const trigger = menu.trigger;
                setMenu(null);
                trigger?.focus();
                void onAction(item.action, menu.branch);
              }}
            >{item.label}</button>
          ))}
        </div>, document.querySelector(".app-shell") ?? document.body) : null}
    </aside>
  );
}

function BranchGroup({ title, count, open, toggleDisabled = false, onToggle, children }: { title: string; count: number; open: boolean; toggleDisabled?: boolean; onToggle: () => void; children: React.ReactNode }) {
  return <section className="branch-group">
    <button type="button" className="branch-group-toggle" aria-expanded={open} aria-disabled={toggleDisabled || undefined} onClick={() => toggleDisabled ? undefined : onToggle()}>
      <ChevronDown size={13} className={open ? "" : "collapsed"} />
      <h3>{title}</h3><small>{count}</small>
    </button>
    {open ? <div className="branch-group-items">{children}</div> : null}
  </section>;
}

function BranchPathTree({ scope, nodes, depth, collapsedFolders, forceExpanded, selectedBranch, busy, onToggleFolder, onSelect, onOpenMenu, onAction }: {
  scope: BranchPathScope;
  nodes: BranchPathNode[];
  depth: number;
  collapsedFolders: Set<string>;
  forceExpanded: boolean;
  selectedBranch: string;
  busy: boolean;
  onToggleFolder: (key: string) => void;
  onSelect: (fullName: string) => void;
  onOpenMenu: (branch: BranchRailItem, event: ReactMouseEvent) => void;
  onAction: (action: BranchAction, branch?: BranchRailItem) => void | Promise<void>;
}) {
  return <>{nodes.map((node) => {
    if (node.kind === "branch") {
      return <BranchRow key={node.key} branch={node.branch} displayName={node.label} depth={depth} selected={selectedBranch === node.branch.fullName} busy={busy} onSelect={onSelect} onOpenMenu={onOpenMenu} onAction={onAction} />;
    }

    const open = forceExpanded || !collapsedFolders.has(node.key);
    const groupId = branchPathGroupId(node.key);
    const scopeLabel = scope === "local" ? "本地分支" : "远程分支";
    return <div className="branch-path-folder" data-branch-scope={scope} data-branch-path={node.path} key={node.key}>
      <button
        type="button"
        className="branch-path-folder-toggle"
        style={{ "--branch-depth": Math.min(depth, 3) } as CSSProperties}
        aria-expanded={open}
        aria-controls={groupId}
        aria-disabled={forceExpanded || undefined}
        aria-label={`${scopeLabel}路径 ${node.path}，${node.branchCount} 个分支`}
        onClick={() => forceExpanded ? undefined : onToggleFolder(node.key)}
      >
        <ChevronDown size={12} className={open ? "" : "collapsed"} />
        {open ? <FolderOpen size={14} /> : <Folder size={14} />}
        <strong>{node.label}</strong>
        <small>{node.branchCount}</small>
      </button>
      {open ? <div id={groupId} className="branch-path-children" role="group" aria-label={`${scopeLabel} ${node.path} 子级`} style={{ "--branch-depth": Math.min(depth, 3) } as CSSProperties}>
        <BranchPathTree scope={scope} nodes={node.children} depth={depth + 1} collapsedFolders={collapsedFolders} forceExpanded={forceExpanded} selectedBranch={selectedBranch} busy={busy} onToggleFolder={onToggleFolder} onSelect={onSelect} onOpenMenu={onOpenMenu} onAction={onAction} />
      </div> : null}
    </div>;
  })}</>;
}

function branchPathGroupId(key: string) {
  return `branch-path-group-${Array.from(key, (character) => character.codePointAt(0)?.toString(16) ?? "0").join("-")}`;
}

function branchRowAccessibleName(branch: BranchRailItem) {
  const parts = [branch.name, branch.current ? "当前分支" : branch.type === "remote" ? "远程分支" : "本地分支"];
  if (branch.upstream) parts.push(`跟踪 ${branch.upstream}`);
  if (typeof branch.ahead === "number" && branch.ahead > 0) parts.push(`领先 ${branch.ahead}`);
  if (typeof branch.behind === "number" && branch.behind > 0) parts.push(`落后 ${branch.behind}`);
  return parts.join("，");
}

function BranchRow({ branch, displayName, depth, selected, busy, onSelect, onOpenMenu, onAction }: {
  branch: BranchRailItem;
  displayName: string;
  depth: number;
  selected: boolean;
  busy: boolean;
  onSelect: (fullName: string) => void;
  onOpenMenu: (branch: BranchRailItem, event: ReactMouseEvent) => void;
  onAction: (action: BranchAction, branch?: BranchRailItem) => void | Promise<void>;
}) {
  return <div className={`branch-row ${selected ? "selected" : ""}`} data-branch-name={branch.name} data-branch-type={branch.type} data-current={branch.current ? "true" : "false"} onContextMenu={(event) => onOpenMenu(branch, event)}>
    <button type="button" className="branch-row-main" style={{ "--branch-depth": Math.min(depth, 3) } as CSSProperties} aria-label={branchRowAccessibleName(branch)} title={branch.name} onClick={() => onSelect(branch.fullName)} onDoubleClick={() => branch.type === "local" && !branch.current ? void onAction("switch", branch) : undefined} disabled={busy}>
      <GitBranch size={14} />
      <span><strong>{displayName}</strong><small>{branch.current ? "当前" : branch.upstream ?? branch.headHash.slice(0, 8)}</small></span>
      {typeof branch.ahead === "number" && branch.ahead > 0 ? <em>↑{branch.ahead}</em> : null}
      {typeof branch.behind === "number" && branch.behind > 0 ? <em>↓{branch.behind}</em> : null}
    </button>
    <button type="button" className="branch-row-menu" aria-label={`${branch.name} 分支操作`} onClick={(event) => onOpenMenu(branch, event)} disabled={busy}><MoreHorizontal size={15} /></button>
  </div>;
}
