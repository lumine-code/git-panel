/** @babel */
/** @jsx React.createElement */
import { CompositeDisposable, Disposable, Emitter } from "lumine";

import path from "path";
import fs from "fs/promises";

import { autobind } from "./helpers";
import WorkdirCache from "./models/workdir-cache";
import WorkdirContext from "./models/workdir-context";
import WorkdirContextPool from "./models/workdir-context-pool";
import Repository from "./models/repository";
import StyleCalculator from "./models/style-calculator";
import PaneItemHost from "./items/pane-item-host";
import Switchboard from "./switchboard";
import yardstick from "./yardstick";
import getRepoPipelineManager from "./get-repo-pipeline-manager";
import {
  getRepositoryWorkingDirectory,
  refreshRepositoryForPath,
  resolveRepositoryForPath,
} from "./repository-api";
import createGitHubBridge from "./github-bridge";
import { location, allowedLocations } from "./items/dock-item-location";

const CENTER_ONLY = Object.freeze(["center"]);

let React;
let RootController;
let createRoot;
let GitTimingsView;
let ContextMenuInterceptor;

function ensureReactRenderer() {
  if (!React) {
    React = require("react");
    ({ createRoot } = require("react-dom/client"));
    const rootControllerModule = require("./controllers/root-controller");
    RootController = rootControllerModule.default || rootControllerModule;
  }
}

function getGitTimingsView() {
  if (!GitTimingsView) {
    const gitTimingsViewModule = require("./views/git-timings-view");
    GitTimingsView = gitTimingsViewModule.default || gitTimingsViewModule;
  }
  return GitTimingsView;
}

function disposeContextMenuInterceptor() {
  if (!ContextMenuInterceptor) {
    try {
      const contextMenuInterceptorModule = require("./context-menu-interceptor");
      ContextMenuInterceptor = contextMenuInterceptorModule.default || contextMenuInterceptorModule;
    } catch (_error) {
      return;
    }
  }
  ContextMenuInterceptor.dispose();
}

const defaultState = {
  newProject: true,
  activeRepositoryPath: null,
  contextLocked: false,
};

// Keep a lightweight opener alive as soon as the package activates. The React
// tree owns the real PaneItem opener, but it is intentionally lazy while the
// Git tab is closed. A cold command must still be able to create the dock item
// before that tree has mounted; the host is adopted and hydrated by PaneItem
// on the first render.
const GIT_TAB_URI = "lumine-github://dock-item/git";

export default class GitPackage {
  constructor({
    workspace,
    project,
    repositories,
    commands,
    notificationManager,
    tooltips,
    styles,
    grammars,
    keymaps,
    config,
    deserializers,
    confirm,
    getInitialPaths,
    configDirPath,
    renderFn,
  }) {
    autobind(
      this,
      "consumeBusySignal",
      "createGitTimingsView",
      "createGitTimingsPaneItem",
      "createGitPaneItem",
      "createDockItemStub",
      "createFilePatchPaneItem",
      "createFilePatchControllerStub",
      "createCommitPreviewPaneItem",
      "createCommitPreviewStub",
      "createCommitDetailPaneItem",
      "createCommitDetailStub",
      "createGitCachePaneItem",
      "destroyGitTabItem",
      "getRepositoryForWorkdir",
      "scheduleActiveContextUpdate",
    );

    this.workspace = workspace;
    this.project = project;
    if (!repositories) {
      throw new Error("git-panel requires the lumine.repositories API");
    }
    this.repositories = repositories;
    this.commands = commands;
    this.deserializers = deserializers;
    this.notificationManager = notificationManager;
    this.tooltips = tooltips;
    this.config = config;
    this.styles = styles;
    this.grammars = grammars;
    this.keymaps = keymaps;

    this.styleCalculator = new StyleCalculator(this.styles, this.config);
    this.confirm = confirm;
    this.activated = false;

    this.initialContextCriteria = {
      projectPathCount: this.project.getPaths().length,
      initPathCount: getInitialPaths().length,
    };

    this.pipelineManager = getRepoPipelineManager({ confirm, notificationManager, workspace });

    this.activeContextUpdatePromise = null;
    this.pendingActiveContextOptions = null;
    this.guessedContext = WorkdirContext.guess(this.initialContextCriteria, this.pipelineManager);
    this.activeContext = this.guessedContext;
    this.startupContextPending = false;
    this.startupComplete = false;
    this.pendingRenderCallbacks = [];
    this.resetRepositoryWorkdirs();
    this.workdirCache = new WorkdirCache();
    this.contextPool = new WorkdirContextPool({
      window,
      workspace,
      pipelineManager: this.pipelineManager,
      getRepositoryDirectories: () =>
        this.repositories.getRepositories().map(getRepositoryWorkingDirectory).filter(Boolean),
    });

    this.switchboard = new Switchboard();
    this.emitter = new Emitter();

    this._roots = new WeakMap();
    this.renderFn =
      renderFn ||
      ((component, node, callback) => {
        let root = this._roots.get(node);
        if (!root) {
          root = createRoot(node);
          this._roots.set(node, root);
        }
        root.render(component);
        if (callback) {
          requestAnimationFrame(callback);
        }
      });

    this.activationDisposed = false;
    this.initializeActivationSubscriptions();
  }

  resetRepositoryWorkdirs() {
    this.lumineRepositoryWorkdirs = new WeakMap();
    for (const lumineRepository of this.repositories.getRepositories()) {
      const workdir = getRepositoryWorkingDirectory(lumineRepository);
      if (workdir) {
        this.lumineRepositoryWorkdirs.set(lumineRepository, workdir);
      }
    }
  }

  initializeActivationSubscriptions() {
    // Handle events from all resident contexts.
    this.subscriptions = new CompositeDisposable(
      this.contextPool.onDidChangeWorkdirOrHead((context) => {
        this.refreshLumineGitRepository(context.getWorkingDirectory());
      }),
      this.contextPool.onDidUpdateRepository((context) => {
        this.switchboard.didUpdateRepository(context.getRepository());
      }),
      this.contextPool.onDidChangeRepositoryState((context) => {
        if (context === this.activeContext) {
          this.rerender();
        }
      }),
      this.contextPool.onDidDestroyRepository((context) => {
        if (context === this.activeContext) {
          this.scheduleActiveContextUpdate();
        }
      }),
      { dispose: disposeContextMenuInterceptor },
    );

    this.setupYardstick();
  }

  restoreActivationState() {
    this.emitter = new Emitter();
    this.guessedContext = WorkdirContext.guess(this.initialContextCriteria, this.pipelineManager);
    this.activeContext = this.guessedContext;
    this.activeContextUpdatePromise = null;
    this.pendingActiveContextOptions = null;
    this.startupContextPending = false;
    this.startupComplete = false;
    this.pendingRenderCallbacks = [];
    this.controllerReadyPromise = null;
    this.controller = null;
    this.gitTabPaneItem = null;
    this.resetRepositoryWorkdirs();
    this.initializeActivationSubscriptions();
    this.activationDisposed = false;
  }

  setupYardstick() {
    const stagingSeries = ["stageLine", "stageHunk", "unstageLine", "unstageHunk"];

    this.subscriptions.add(
      // Staging and unstaging operations
      this.switchboard.onDidBeginStageOperation((payload) => {
        if (payload.stage && payload.line) {
          yardstick.begin("stageLine");
        } else if (payload.stage && payload.hunk) {
          yardstick.begin("stageHunk");
        } else if (payload.stage && payload.file) {
          yardstick.begin("stageFile");
        } else if (payload.stage && payload.mode) {
          yardstick.begin("stageMode");
        } else if (payload.stage && payload.symlink) {
          yardstick.begin("stageSymlink");
        } else if (payload.unstage && payload.line) {
          yardstick.begin("unstageLine");
        } else if (payload.unstage && payload.hunk) {
          yardstick.begin("unstageHunk");
        } else if (payload.unstage && payload.file) {
          yardstick.begin("unstageFile");
        } else if (payload.unstage && payload.mode) {
          yardstick.begin("unstageMode");
        } else if (payload.unstage && payload.symlink) {
          yardstick.begin("unstageSymlink");
        }
      }),
      this.switchboard.onDidUpdateRepository(() => {
        yardstick.mark(stagingSeries, "update-repository");
      }),
      this.switchboard.onDidFinishRender((context) => {
        if (context === "RootController.showFilePatchForPath") {
          yardstick.finish(stagingSeries);
        }
      }),

      // Active context changes
      this.switchboard.onDidScheduleActiveContextUpdate(() => {
        yardstick.begin("activeContextChange");
      }),
      this.switchboard.onDidBeginActiveContextUpdate(() => {
        yardstick.mark("activeContextChange", "queue-wait");
      }),
      this.switchboard.onDidFinishContextChangeRender(() => {
        yardstick.mark("activeContextChange", "render");
      }),
      this.switchboard.onDidFinishActiveContextUpdate(() => {
        yardstick.finish("activeContextChange");
      }),
    );
  }

  registerGlobalCommands() {
    this.subscriptions.add(
      this.commands.add("lumine-workspace", {
        "git-panel:toggle-git-tab": () =>
          this.ensureRootController().then(({ root }) => root.gitTabTracker.toggle()),
        "git-panel:toggle-focus": () =>
          this.ensureRootController().then(({ root }) => root.gitTabTracker.toggleFocus()),
        "git-panel:toggle-commit-preview": {
          description: "Show what the staged changes would commit as, before committing.",
          didDispatch: () => this.invokeGitController("toggleCommitPreviewItem"),
        },
        "git-panel:show-waterfall-diagnostics": {
          description: "Open a timing report of the Git calls this window has made.",
          didDispatch: () => this.invokeGitController("showWaterfallDiagnostics"),
        },
        "git-panel:show-cache-diagnostics": {
          description: "Report what the Git cache is holding and what it has missed.",
          didDispatch: () => this.invokeGitController("showCacheDiagnostics"),
        },
        "git-panel:initialize": {
          description: "Create a Git repository in a project folder you choose.",
          didDispatch: () => this.invokeGitController("openInitializeDialog"),
        },
        "git-panel:clone": {
          description: "Clone a remote repository into a folder you choose.",
          didDispatch: () => this.invokeGitController("openCloneDialog"),
        },
        "git-panel:open-commit": {
          description: "Open a commit by the hash you type, and show what it changed.",
          didDispatch: () => this.invokeGitController("openCommitDialog"),
        },
        "git-panel:view-unstaged-changes-for-current-file": {
          description: "Open the diff of what this file has that is not yet staged.",
          didDispatch: () => this.invokeGitController("viewUnstagedChangesForCurrentFile"),
        },
        "git-panel:view-staged-changes-for-current-file": {
          description: "Open the diff of what this file has already staged.",
          didDispatch: () => this.invokeGitController("viewStagedChangesForCurrentFile"),
        },
        "git-panel:close-all-diff-views": {
          description: "Close every diff tab this package has opened.",
          didDispatch: () => this.invokeGitController("destroyFilePatchPaneItems"),
        },
        "git-panel:close-empty-diff-views": {
          description: "Close the diff tabs whose file no longer has changes.",
          didDispatch: () => this.invokeGitController("destroyEmptyFilePatchPaneItems"),
        },
      }),
    );
  }

  registerDockItemOpener() {
    this.subscriptions.add(
      this.workspace.addOpener((uri) => {
        if (uri !== GIT_TAB_URI) return undefined;
        return this.createGitPaneItem({ uri });
      }),
    );
  }

  ensureRootController() {
    if (this.controller?.gitController) {
      return Promise.resolve({ root: this.controller, git: this.controller.gitController });
    }
    if (!this.controllerReadyPromise) {
      // A user command is stronger than the startup idle optimization: render
      // the lightweight root now, so the first dispatch can perform its action.
      this.startupComplete = true;
      this.controllerReadyPromise = new Promise((resolve, reject) => {
        // React 19's concurrent root may invoke the render callback before
        // class refs have been attached. Polling on animation frames avoids a
        // first-command race where the cold command is consumed but the panel
        // only appears on the second invocation.
        const deadline = Date.now() + 5000;
        const check = () => {
          if (this.controller?.gitController) {
            resolve({ root: this.controller, git: this.controller.gitController });
            return;
          }
          if (!this.activated || Date.now() >= deadline) {
            reject(new Error("Git panel root did not mount"));
            return;
          }
          const schedule =
            globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 0));
          schedule(check);
        };
        this.scheduleRerender();
        check();
      }).finally(() => {
        this.controllerReadyPromise = null;
      });
    }
    return this.controllerReadyPromise;
  }

  invokeGitController(method, ...args) {
    return this.ensureRootController().then(({ git }) => git[method](...args));
  }

  activate(state = {}, { signal } = {}) {
    signal?.throwIfAborted();
    if (this.activationDisposed) {
      this.restoreActivationState();
    }
    const savedState = { ...defaultState, ...state };

    this.startOpenGitTab = this.config.get("git-panel.openGitTabOnStart");
    this.registerDockItemOpener();
    this.registerGlobalCommands();

    const hasSelectedFiles = (event) => {
      return !!event.target.closest(".git-panel-FilePatchListView").querySelector(".is-selected");
    };

    this.subscriptions.add(
      this.repositories.onDidChangeActiveRepository(this.handleActiveRepositoryChange),
      this.project.onDidChangePaths(this.handleProjectPathsChange),
      this.repositories.onDidAddRepository((lumineRepo) => {
        const workdir = getRepositoryWorkingDirectory(lumineRepo);
        this.workdirCache.invalidate();
        if (workdir && this.contextPool.has(workdir)) {
          this.lumineRepositoryWorkdirs.set(lumineRepo, workdir);
          this.contextPool.reconcileRepositoryAdded(workdir);
        } else if (workdir) {
          this.lumineRepositoryWorkdirs.set(lumineRepo, workdir);
        }
        this.scheduleActiveContextUpdate();
      }),
      this.repositories.onDidRemoveRepository((lumineRepo) => {
        const workdir = this.lumineRepositoryWorkdirs.get(lumineRepo);
        this.lumineRepositoryWorkdirs.delete(lumineRepo);
        this.workdirCache.invalidate();
        if (workdir && this.contextPool.has(workdir)) {
          this.contextPool.replace(workdir);
        }
        this.scheduleActiveContextUpdate();
      }),
      this.styleCalculator.startWatching(
        "git-panel-styles",
        ["editor.fontSize", "editor.fontFamily", "editor.lineHeight", "editor.tabLength"],
        (config) => `
          .git-panel-HunkView-line {
            font-family: ${config.get("editor.fontFamily")};
            line-height: ${config.get("editor.lineHeight")};
            tab-size: ${config.get("editor.tabLength")}
          }
        `,
      ),
      lumine.contextMenu.add({
        ".git-panel-UnstagedChanges .git-panel-FilePatchListView": [
          {
            label: "Stage",
            command: "core:confirm",
            shouldDisplay: hasSelectedFiles,
          },
          {
            type: "separator",
            shouldDisplay: hasSelectedFiles,
          },
          {
            label: "Discard Changes",
            command: "git-panel:discard-changes-in-selected-files",
            shouldDisplay: hasSelectedFiles,
          },
        ],
        ".git-panel-StagedChanges .git-panel-FilePatchListView": [
          {
            label: "Unstage",
            command: "core:confirm",
            shouldDisplay: hasSelectedFiles,
          },
        ],
        ".git-panel-MergeConflictPaths .git-panel-FilePatchListView": [
          {
            label: "Stage",
            command: "core:confirm",
            shouldDisplay: hasSelectedFiles,
          },
          {
            type: "separator",
            shouldDisplay: hasSelectedFiles,
          },
          {
            label: "Resolve File As Ours",
            command: "git-panel:resolve-file-as-ours",
            shouldDisplay: hasSelectedFiles,
          },
          {
            label: "Resolve File As Theirs",
            command: "git-panel:resolve-file-as-theirs",
            shouldDisplay: hasSelectedFiles,
          },
        ],
      }),
    );

    this.activated = true;

    if (this.startOpenGitTab) {
      this.startupComplete = true;
    } else {
      // The root owns the status tile and pane UI, but a closed Git tab does
      // not need React to finish opening the editor. Mount it once Chromium is
      // idle so service and repository state remain ready without blocking the
      // startup critical path.
      lumine.window.whenLoaded().then(() => {
        if (!this.activated || this.startupComplete) return;
        const schedule = globalThis.requestIdleCallback || ((callback) => setTimeout(callback, 0));
        this.startupRenderHandle = schedule(
          () => {
            this.startupRenderHandle = null;
            if (!this.activated) return;
            this.startupComplete = true;
            this.scheduleRerender();
          },
          { timeout: 2000 },
        );
      });
    }

    // When a repository selection is being restored, hold a loading state until
    // it resolves instead of flashing the first project root's empty "Create
    // Repository" view while repositories are still being discovered/adopted.
    if (savedState.activeRepositoryPath) {
      this.startupContextPending = true;
      if (this.activeContext === this.guessedContext) {
        const loadingGuess = WorkdirContext.guess({ preferLoading: true }, this.pipelineManager);
        this.guessedContext.destroy();
        this.guessedContext = loadingGuess;
        this.activeContext = loadingGuess;
      }
    }

    this.scheduleStartupActiveContextUpdate({
      usePath: savedState.activeRepositoryPath,
      lock: savedState.contextLocked,
    });
    this.scheduleRerender();
  }

  handleActiveRepositoryChange = () => {
    if (!this.activated) {
      return;
    }
    this.scheduleActiveContextUpdate();
    // The pinned state may change without the repository changing; the lock
    // control still has to re-render.
    this.scheduleRerender();
  };

  handleProjectPathsChange = () => {
    this.scheduleActiveContextUpdate();
  };

  serialize() {
    return {
      activeRepositoryPath: this.getActiveWorkdir(),
      contextLocked: this.repositories.isActiveRepositoryPinned(),
      newProject: false,
    };
  }

  scheduleRerender(callback) {
    if (callback) {
      this.pendingRenderCallbacks.push(callback);
    }
    if (!this.startupComplete) {
      return;
    }
    if (this.renderScheduled) {
      return;
    }

    this.renderScheduled = true;

    const schedule = typeof setImmediate === "function" ? setImmediate : setTimeout;
    schedule(() => {
      this.renderScheduled = false;
      const callbacks = this.pendingRenderCallbacks;
      this.pendingRenderCallbacks = [];
      if (!this.activated || this.workspace.isDestroyed()) {
        return;
      }
      this.rerender(() => {
        callbacks.forEach((cb) => cb());
      });
    }, 0);
  }

  scheduleStartupActiveContextUpdate({ usePath, lock }) {
    const schedule = typeof setImmediate === "function" ? setImmediate : setTimeout;
    schedule(async () => {
      if (!this.activated || this.workspace.isDestroyed()) {
        return;
      }
      // Restore the previous window's selection into lumine.repositories before
      // deriving the panel context from it.
      if (usePath) {
        try {
          await this.repositories.setActiveRepositoryForPath(usePath, { pin: Boolean(lock) });
        } catch (_e) {}
      }
      if (!this.activated || this.workspace.isDestroyed()) {
        return;
      }
      // Keep the loading guess active until this specific context has resolved.
      // Repository registration may happen as part of the resolution itself, so
      // clearing the startup gate before this await exposes provisional data.
      try {
        await this.scheduleActiveContextUpdate({
          usePath,
          waitForRepository: Boolean(usePath),
        });
      } finally {
        this.startupContextPending = false;
      }
    }, 0);
  }

  rerender(callback) {
    if (this.workspace.isDestroyed()) {
      return;
    }

    if (!this.activated) {
      return;
    }

    ensureReactRenderer();

    if (!this.element) {
      this.element = document.createElement("div");
      this.subscriptions.add(
        new Disposable(() => {
          const root = this._roots.get(this.element);
          if (root) {
            root.unmount();
            this._roots.delete(this.element);
          }
          delete this.element;
        }),
      );
    }

    this.renderFn(
      <RootController
        ref={(c) => {
          this.controller = c;
        }}
        workspace={this.workspace}
        deserializers={this.deserializers}
        commands={this.commands}
        notificationManager={this.notificationManager}
        tooltips={this.tooltips}
        grammars={this.grammars}
        keymaps={this.keymaps}
        config={this.config}
        project={this.project}
        repositories={this.repositories}
        confirm={this.confirm}
        workdirContextPool={this.contextPool}
        repository={this.getActiveRepository()}
        resolutionProgress={this.getActiveResolutionProgress()}
        busySignal={this.busySignal}
        initialize={this.initializeRepo}
        clone={this.clone}
        switchboard={this.switchboard}
        startOpenGitTab={this.startOpenGitTab}
        createGitPaneItem={this.createGitPaneItem}
        createFilePatchPaneItem={this.createFilePatchPaneItem}
        createCommitPreviewPaneItem={this.createCommitPreviewPaneItem}
        createCommitDetailPaneItem={this.createCommitDetailPaneItem}
        createGitTimingsPaneItem={this.createGitTimingsPaneItem}
        createGitCachePaneItem={this.createGitCachePaneItem}
        removeFilePatchItem={this.removeFilePatchItem}
        currentWorkDir={this.getActiveWorkdir()}
      />,
      this.element,
      callback,
    );
  }

  async deactivate() {
    this.activated = false;
    if (this.startupRenderHandle != null) {
      if (globalThis.cancelIdleCallback) {
        cancelIdleCallback(this.startupRenderHandle);
      } else {
        clearTimeout(this.startupRenderHandle);
      }
      this.startupRenderHandle = null;
    }

    // Destroy all package pane items before unmounting the React tree
    const items = this.workspace.getPaneItems().filter((item) => {
      const uri = item.getURI && item.getURI();
      return (
        uri === GIT_TAB_URI ||
        uri?.startsWith("lumine-github://file-patch/") ||
        uri?.startsWith("lumine-github://commit-preview") ||
        uri?.startsWith("lumine-github://commit-detail") ||
        uri === "lumine-github://debug/timings" ||
        uri === "lumine-github://debug/cache"
      );
    });
    for (const item of items) {
      const pane = this.workspace.paneForItem(item);
      if (pane) {
        // Dock items are permanent outside the center pane; force teardown so
        // an update cannot leave the old generation visible and hydrated.
        await pane.destroyItem(item, true);
      }
    }

    this.subscriptions.dispose();
    this.emitter.dispose();
    this.contextPool.clear();
    if (this.guessedContext) {
      this.guessedContext.destroy();
      this.guessedContext = null;
    }
    this.controller = null;
    this.controllerReadyPromise = null;
    this.activationDisposed = true;
    await yardstick.flush();
  }

  consumeBusySignal(busySignal) {
    this.busySignal = busySignal;
    this.scheduleRerender();
    return new Disposable(() => {
      this.busySignal = null;
      this.scheduleRerender();
    });
  }

  createGitTimingsView(options) {
    return GitPackage.prototype.createGitTimingsPaneItem.call(this, options);
  }

  createGitTimingsPaneItem({ uri = null, deserialized = {} } = {}) {
    const TimingsView = getGitTimingsView();
    const itemURI = uri || TimingsView.buildURI();
    return PaneItemHost.create("git-timings-view", {
      classPrefix: "git-panel",
      title: "Git Panel Timings View",
      uri: itemURI,
      hydrationProps: deserialized,
      allowedLocations: CENTER_ONLY,
      serializeFallback: () => ({ deserializer: "GitTimingsView" }),
    });
  }

  createGitPaneItem({ uri, deserialized = {} } = {}) {
    if (uri !== GIT_TAB_URI) {
      throw new Error(`Invalid Git pane item URI: ${uri}`);
    }

    const item = PaneItemHost.create("git", {
      classPrefix: "git-panel",
      title: "Git",
      iconName: "git-commit",
      defaultLocation: location,
      allowedLocations,
      uri,
      hydrationProps: deserialized,
      serializeFallback: () => ({ deserializer: "GitDockItem", uri }),
    });
    this.gitTabPaneItem = this.gitTabPaneItem || item;

    if (this.controller) this.scheduleRerender();
    return item;
  }

  createDockItemStub(options) {
    return GitPackage.prototype.createGitPaneItem.call(this, options);
  }

  createFilePatchPaneItem({ uri, deserialized = {} } = {}) {
    const item = PaneItemHost.create("git-file-patch-controller", {
      classPrefix: "git-panel",
      title: "Diff",
      uri,
      hydrationProps: deserialized,
      allowedLocations: CENTER_ONLY,
      serializeFallback: () => ({ deserializer: "FilePatchControllerStub", uri }),
    });
    if (this.controller) this.scheduleRerender();
    return item;
  }

  createFilePatchControllerStub(options) {
    return GitPackage.prototype.createFilePatchPaneItem.call(this, options);
  }

  createCommitPreviewPaneItem({ uri, deserialized = {} } = {}) {
    const item = PaneItemHost.create("git-commit-preview", {
      classPrefix: "git-panel",
      title: "Commit preview",
      uri,
      hydrationProps: deserialized,
      allowedLocations: CENTER_ONLY,
      serializeFallback: () => ({ deserializer: "CommitPreviewStub", uri }),
    });
    if (this.controller) this.scheduleRerender();
    return item;
  }

  createCommitPreviewStub(options) {
    return GitPackage.prototype.createCommitPreviewPaneItem.call(this, options);
  }

  createCommitDetailPaneItem({ uri, deserialized = {} } = {}) {
    const item = PaneItemHost.create("git-commit-detail", {
      classPrefix: "git-panel",
      title: "Commit",
      uri,
      hydrationProps: deserialized,
      allowedLocations: CENTER_ONLY,
      serializeFallback: () => ({ deserializer: "CommitDetailStub", uri }),
    });
    if (this.controller) this.scheduleRerender();
    return item;
  }

  createCommitDetailStub(options) {
    return GitPackage.prototype.createCommitDetailPaneItem.call(this, options);
  }

  createGitCachePaneItem({ uri, deserialized = {} } = {}) {
    return PaneItemHost.create("git-cache-view", {
      classPrefix: "git-panel",
      title: "GitHub Package Cache View",
      uri,
      hydrationProps: deserialized,
      allowedLocations: CENTER_ONLY,
      serializeFallback: () => null,
    });
  }

  destroyGitTabItem() {
    if (this.gitTabPaneItem) {
      this.gitTabPaneItem.destroy();
      this.gitTabPaneItem = null;
      if (this.controller) {
        this.scheduleRerender();
      }
    }
  }

  initializeRepo = async (projectPath) => {
    await this.repositories.initialize(projectPath);
    this.workdirCache.invalidate();

    if (!this.project.contains(projectPath)) {
      this.project.addPath(projectPath);
    }

    await this.refreshLumineGitRepository(projectPath);
    await this.scheduleActiveContextUpdate();
  };

  clone = async (remoteUrl, projectPath, sourceRemoteName = "origin") => {
    await this.repositories.clone(remoteUrl, projectPath, { sourceRemoteName });
    this.workdirCache.invalidate();
    this.project.addPath(projectPath);
    await this.scheduleActiveContextUpdate();
  };

  getRepositoryForWorkdir(projectPath) {
    const loadingGuessRepo = Repository.loadingGuess({ pipelineManager: this.pipelineManager });
    return this.guessedContext
      ? loadingGuessRepo
      : this.contextPool.add(projectPath).getRepository();
  }

  getActiveWorkdir() {
    return this.activeContext.getWorkingDirectory();
  }

  getActiveRepository() {
    return this.activeContext.getRepository();
  }

  getActiveResolutionProgress() {
    return this.activeContext.getResolutionProgress();
  }

  getContextPool() {
    return this.contextPool;
  }

  getSwitchboard() {
    return this.switchboard;
  }

  isContextLocked() {
    return this.repositories.isActiveRepositoryPinned();
  }

  openGitTab() {
    return this.ensureRootController().then(({ root }) => root.gitTabTracker.toggleFocus());
  }

  openCloneDialog() {
    return this.invokeGitController("openCloneDialog");
  }

  openInitializeDialog() {
    return this.invokeGitController("openInitializeDialog");
  }

  onDidUpdate(cb) {
    return this.emitter.on("did-update", cb);
  }

  // The `git-panel` service: the shared diff/patch pipeline and a
  // mirror of the active-repository context, so github-panel never reaches into
  // git-panel internals.
  provideGitPanel() {
    return createGitHubBridge(this);
  }

  scheduleActiveContextUpdate(options = {}) {
    this.switchboard.didScheduleActiveContextUpdate();
    // Repository discovery emits a generic update for every adopted worktree.
    // Collapse those into the pending update without allowing a later generic
    // event to erase an explicit repository selection.
    this.pendingActiveContextOptions = {
      ...this.pendingActiveContextOptions,
      ...options,
    };
    if (!this.activeContextUpdatePromise) {
      this.activeContextUpdatePromise = this.runActiveContextUpdates();
    }
    return this.activeContextUpdatePromise;
  }

  async runActiveContextUpdates() {
    try {
      while (this.pendingActiveContextOptions) {
        const options = this.pendingActiveContextOptions;
        this.pendingActiveContextOptions = null;
        await this.updateActiveContext(options);
      }
    } finally {
      this.activeContextUpdatePromise = null;
    }
  }

  async getNextContext(usePath = null, { waitForRepository = false } = {}) {
    const workdirForNonGitPath = async (sourcePath) => {
      const containingRoot = this.project
        .getDirectories()
        .find((root) => root.contains(sourcePath));
      if (containingRoot) {
        return containingRoot.getPath();
      } else {
        let stat;
        try {
          stat = await fs.stat(sourcePath);
        } catch (_e) {
          return null;
        }
        return stat.isDirectory() ? sourcePath : path.dirname(sourcePath);
      }
    };

    const workdirForPath = async (sourcePath) => {
      const lumineRepository = await resolveRepositoryForPath(this.repositories, sourcePath);
      return (
        getRepositoryWorkingDirectory(lumineRepository) ||
        (await this.workdirCache.find(sourcePath)) ||
        (await workdirForNonGitPath(sourcePath))
      );
    };

    const candidatePaths = new Set(this.project.getPaths());

    // The window's active repository context is owned by lumine.repositories; the
    // panel only mirrors it into a context. A context without a repository
    // still carries the focused directory, so the panel follows the active
    // editor out of every repository and can offer to initialize or clone
    // there instead of jumping to an unrelated repository.
    const activeRepositoryContext = this.repositories.getActiveRepositoryContext
      ? this.repositories.getActiveRepositoryContext()
      : {
          repository: this.repositories.getActiveRepository(),
          workingDirectory: null,
        };
    const activeWorkdir =
      getRepositoryWorkingDirectory(activeRepositoryContext.repository) ||
      activeRepositoryContext.workingDirectory ||
      null;
    if (activeWorkdir) {
      candidatePaths.add(activeWorkdir);
    }

    let firstProjectWorkdir = null;

    const workdirs = new Set(
      (
        await Promise.all(
          Array.from(candidatePaths, async (candidatePath) => {
            const workdir = await workdirForPath(candidatePath);

            if (candidatePath === this.project.getPaths()[0]) {
              firstProjectWorkdir = workdir;
            }

            return workdir;
          }),
        )
      ).filter(Boolean),
    );

    for (const workdir of workdirs) {
      this.contextPool.add(workdir);
    }

    // While a saved repository selection is being restored, never leave the
    // loading guess for a context whose repository is not yet present: repos are
    // still being discovered/adopted, so an empty context here is the transient
    // "Create Repository" flash rather than a real repository-less project.
    const hasPresentRepository = (context) => Boolean(context?.getRepository?.().isPresent?.());
    const deferAbsentDuringStartup = (context) => {
      if (this.startupContextPending && !hasPresentRepository(context)) {
        return this.activeContext;
      }
      return context;
    };

    if (usePath) {
      let useWorkdir;
      if (usePath === this.project.getPaths()[0]) {
        useWorkdir = firstProjectWorkdir;
      } else {
        useWorkdir = await workdirForPath(usePath);
      }

      if (useWorkdir) {
        this.contextPool.add(useWorkdir);
      }
      const stateContext = this.contextPool.getContext(useWorkdir);
      if (stateContext.isPresent()) {
        if (waitForRepository) {
          await stateContext.getRepository().getLoadPromise();
        }
        return stateContext;
      }
    }

    if (activeWorkdir) {
      return deferAbsentDuringStartup(this.contextPool.getContext(activeWorkdir));
    }

    if (firstProjectWorkdir) {
      return deferAbsentDuringStartup(this.contextPool.getContext(firstProjectWorkdir));
    }

    if (
      this.project.getPaths().length === 0 &&
      !this.activeContext.getRepository().isUndetermined()
    ) {
      return WorkdirContext.absent({ pipelineManager: this.pipelineManager });
    }

    return this.activeContext;
  }

  setActiveContext(nextActiveContext) {
    if (nextActiveContext !== this.activeContext) {
      if (this.activeContext === this.guessedContext) {
        this.guessedContext.destroy();
        this.guessedContext = null;
      }
      this.activeContext = nextActiveContext;

      this.scheduleRerender(() => {
        this.switchboard.didFinishContextChangeRender();
        this.switchboard.didFinishActiveContextUpdate();
      });
      this.emitter.emit("did-update");
    } else {
      this.switchboard.didFinishActiveContextUpdate();
    }
  }

  async updateActiveContext(options) {
    if (this.workspace.isDestroyed()) {
      return;
    }

    this.switchboard.didBeginActiveContextUpdate();

    const nextActiveContext = await this.getNextContext(options.usePath, options);
    this.setActiveContext(nextActiveContext);
  }

  async refreshLumineGitRepository(workdir) {
    try {
      await refreshRepositoryForPath(this.repositories, workdir);
    } catch (_e) {}
  }
}
