import { mergeMenuCommandQueue, type MenuCommand } from "./platformConfig";

export type MenuWindowLike = object;

export type MenuCommandDispatcherDependencies<TWindow extends MenuWindowLike> = {
  getFocusedWindow: () => TWindow | null;
  getFallbackWindow: () => TWindow | null;
  createWindow: () => Promise<TWindow | null>;
  isDestroyed: (window: TWindow) => boolean;
  send: (window: TWindow, command: MenuCommand) => void;
  maxQueueSize?: number;
};

export class MenuCommandDispatcher<TWindow extends MenuWindowLike> {
  private readonly activeWindows = new Set<TWindow>();
  private readonly readyWindows = new Set<TWindow>();
  private readonly invalidatedWindows = new Set<TWindow>();
  private readonly dependencies: MenuCommandDispatcherDependencies<TWindow>;
  private queue: MenuCommand[] = [];
  private createPromise: Promise<void> | undefined;

  constructor(dependencies: MenuCommandDispatcherDependencies<TWindow>) {
    this.dependencies = dependencies;
  }

  registerWindow(window: TWindow): void {
    this.invalidatedWindows.delete(window);
    this.activeWindows.add(window);
  }

  markReady(window: TWindow): void {
    if (this.invalidatedWindows.has(window) || this.dependencies.isDestroyed(window)) {
      return;
    }
    this.registerWindow(window);
    this.readyWindows.add(window);
    this.flush(window);
  }

  invalidate(window: TWindow): void {
    this.readyWindows.delete(window);
    this.activeWindows.delete(window);
    this.invalidatedWindows.add(window);
  }

  dispatch(command: MenuCommand): boolean {
    const target = this.currentWindow();
    if (target && this.readyWindows.has(target)) {
      try {
        this.dependencies.send(target, command);
        return true;
      } catch {
        this.queueCommand(command);
        return false;
      }
    }

    const accepted = this.queueCommand(command);
    if (!target && accepted) {
      void this.ensureWindow();
    }
    return false;
  }

  pendingCommands(): MenuCommand[] {
    return [...this.queue];
  }

  private queueCommand(command: MenuCommand): boolean {
    const result = mergeMenuCommandQueue(this.queue, command, this.dependencies.maxQueueSize ?? 32);
    if (result.accepted) {
      this.queue = result.queue;
    }
    return result.accepted;
  }

  private currentWindow(): TWindow | null {
    const focused = this.dependencies.getFocusedWindow();
    if (this.isUsable(focused)) {
      return focused;
    }
    const fallback = this.dependencies.getFallbackWindow();
    return this.isUsable(fallback) ? fallback : null;
  }

  private isUsable(window: TWindow | null): window is TWindow {
    if (!window) {
      return false;
    }
    return !this.invalidatedWindows.has(window) && !this.dependencies.isDestroyed(window);
  }

  private async ensureWindow(): Promise<void> {
    if (this.createPromise) {
      return this.createPromise;
    }

    this.createPromise = this.dependencies.createWindow()
      .then((window) => {
        if (window && !this.dependencies.isDestroyed(window)) {
          this.registerWindow(window);
          this.flush(window);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        this.createPromise = undefined;
      });
    return this.createPromise;
  }

  private flush(window: TWindow): void {
    while (this.queue.length > 0 && this.readyWindows.has(window) && this.isUsable(window)) {
      const command = this.queue.shift()!;
      try {
        this.dependencies.send(window, command);
      } catch {
        this.queue.unshift(command);
        return;
      }
    }
  }
}
