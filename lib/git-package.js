/** @babel */
/** @jsx h */
import { createRequire } from "node:module";
import { CompositeDisposable, Disposable, Emitter } from "lumine";

import path from "path";
import fs from "fs/promises";

import { autobind } from "./helpers.js";
import WorkdirCache from "./models/workdir-cache.js";
import WorkdirContext from "./models/workdir-context.js";
import WorkdirContextPool from "./models/workdir-context-pool.js";
import Repository from "./models/repository.js";
import StyleCalculator from "./models/style-calculator.js";
import PaneItemHost from "./items/pane-item-host.js";
import Switchboard from "./switchboard.js";
import yardstick from "./yardstick.js";
import getRepoPipelineManager from "./get-repo-pipeline-manager.js";
import {
  getRepositoryWorkingDirectory,
  refreshRepositoryForPath,
  resolveRepositoryForPath,
} from "./repository-api.js";
import createPanelService from "./panel-service.js";
import dockItemLocation from "./items/dock-item-location.js";

import registerGlobalCommands from "./bootstrap-commands.js";

const require = import.meta.require ?? createRequire(import.meta.url);
const { location, allowedLocations } = dockItemLocation;

const CENTER_ONLY = Object.freeze(["center"]);

let RootController;
let h;
let mount;
let GitTimingsView;
let ContextMenuInterceptor;

function ensureEtchRenderer() {
  if (!h) {
    ({ h, mount } = require("./etch/view"));
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

// Keep openers available before the lazy native views have been constructed.
const GIT_TAB_URI = "lumine-git://dock-item/git";

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
      "createPatchPaneItem",
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
    this.activeObservation = null;
    this.pendingActiveObservations = new Set();
    this.startupContextPending = true;
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
          root = mount(component, node);
          this._roots.set(node, root);
        } else {
          root.update(component);
        }
        if (callback) {
          callback();
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
    this.activationGeneration = {};
    this.busySignalProviders = new Map();
    this.busySignal = null;
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
    this.activeObservation = null;
    this.pendingActiveObservations = new Set();
    this.activeContextUpdatePromise = null;
    this.pendingActiveContextOptions = null;
    this.startupContextPending = true;
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
    this.subscriptions.add(registerGlobalCommands(this.commands, () => this));
  }

  registerDockItemOpener() {
    this.subscriptions.add(
      this.workspace.addOpener((uri) => {
        if (uri !== GIT_TAB_URI) return undefined;
        return this.createGitPaneItem({ uri });
      }),
    );
  }

  async ensureRootController() {
    const generation = this.activationGeneration;
    if (!this.activated || generation !== this.activationGeneration)
      throw new Error("Git panel activation was cancelled");
    if (this.controller?.gitController) {
      return Promise.resolve({ root: this.controller, git: this.controller.gitController });
    }
    // Native view construction completes synchronously, including its refs.
    this.startupComplete = true;
    this.rerender();
    return this.controller?.gitController
      ? Promise.resolve({ root: this.controller, git: this.controller.gitController })
      : Promise.reject(new Error("Git panel root did not mount"));
  }

  invokeGitController(method, ...args) {
    return this.ensureRootController().then(({ git }) => git[method](...args));
  }

  activate({ signal, entryPointsRegistered = false } = {}) {
    signal?.throwIfAborted();
    if (this.activationDisposed) {
      this.restoreActivationState();
    }

    this.startOpenGitTab = this.config.get("git-panel.openGitTabOnStart");
    if (!entryPointsRegistered) {
      this.registerDockItemOpener();
      this.registerGlobalCommands();
    }

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
            type: "separator",
            shouldDisplay: hasSelectedFiles,
          },
          {
            label: "Stage Selected Files",
            command: "core:confirm",
            beforeGroupContaining: ["git-panel:jump-to-file"],
            shouldDisplay: hasSelectedFiles,
          },
          {
            label: "Discard Changes in Selected Files",
            command: "git-panel:discard-changes-in-selected-files",
            shouldDisplay: hasSelectedFiles,
          },
          {
            type: "separator",
            shouldDisplay: hasSelectedFiles,
          },
        ],
        ".git-panel-StagedChanges .git-panel-FilePatchListView": [
          {
            type: "separator",
            shouldDisplay: hasSelectedFiles,
          },
          {
            label: "Unstage Selected Files",
            command: "core:confirm",
            beforeGroupContaining: ["git-panel:jump-to-file"],
            shouldDisplay: hasSelectedFiles,
          },
          {
            type: "separator",
            shouldDisplay: hasSelectedFiles,
          },
        ],
        ".git-panel-MergeConflictPaths .git-panel-FilePatchListView": [
          {
            type: "separator",
            shouldDisplay: hasSelectedFiles,
          },
          {
            label: "Stage Selected Files",
            command: "core:confirm",
            beforeGroupContaining: ["git-panel:jump-to-file"],
            shouldDisplay: hasSelectedFiles,
          },
          {
            type: "separator",
            shouldDisplay: hasSelectedFiles,
          },
          {
            label: "Resolve File as Ours",
            command: "git-panel:resolve-file-as-ours",
            shouldDisplay: hasSelectedFiles,
          },
          {
            label: "Resolve File as Theirs",
            command: "git-panel:resolve-file-as-theirs",
            shouldDisplay: hasSelectedFiles,
          },
          {
            type: "separator",
            shouldDisplay: hasSelectedFiles,
          },
        ],
      }),
    );

    this.activated = true;

    if (this.startOpenGitTab) {
      this.startupComplete = true;
    } else {
      // The root owns pane UI, but a closed Git tab can finish opening the editor first.
      // Mount it once Chromium is
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

    this.scheduleStartupActiveContextUpdate();
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

  scheduleStartupActiveContextUpdate() {
    const generation = this.activationGeneration;
    const schedule = typeof setImmediate === "function" ? setImmediate : setTimeout;
    schedule(async () => {
      if (
        generation !== this.activationGeneration ||
        !this.activated ||
        this.workspace.isDestroyed()
      ) {
        return;
      }
      // Workspace restoration can change the active item and project roots
      // after package activation. Keep one loading view until restoration and
      // the resulting repository observation have both settled.
      try {
        await lumine.window.whenLoaded();
        if (
          generation !== this.activationGeneration ||
          !this.activated ||
          this.workspace.isDestroyed()
        ) {
          return;
        }
        await this.scheduleActiveContextUpdate();
      } finally {
        if (generation === this.activationGeneration) {
          this.startupContextPending = false;
          this.scheduleRerender();
        }
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

    ensureEtchRenderer();

    if (!this.element) {
      this.element = document.createElement("div");
      this.subscriptions.add(
        new Disposable(() => {
          const root = this._roots.get(this.element);
          if (root) {
            root.destroy();
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
        startupContextPending={this.startupContextPending}
        resolutionProgress={this.getActiveResolutionProgress()}
        busySignal={this.busySignal}
        initialize={this.initializeRepo}
        clone={this.clone}
        switchboard={this.switchboard}
        startOpenGitTab={this.startOpenGitTab}
        createGitPaneItem={this.createGitPaneItem}
        createPatchPaneItem={this.createPatchPaneItem}
        selectRepository={this.selectRepository}
        createGitTimingsPaneItem={this.createGitTimingsPaneItem}
        createGitCachePaneItem={this.createGitCachePaneItem}
        currentWorkDir={this.getActiveWorkdir()}
      />,
      this.element,
      callback,
    );
  }

  async deactivate() {
    this.activated = false;
    this.activationDisposed = true;
    this.activationGeneration = null;
    this.pendingActiveContextOptions = null;
    this.activeContextUpdatePromise = null;
    if (this.startupRenderHandle != null) {
      if (globalThis.cancelIdleCallback) {
        cancelIdleCallback(this.startupRenderHandle);
      } else {
        clearTimeout(this.startupRenderHandle);
      }
      this.startupRenderHandle = null;
    }

    this.activeObservation?.dispose();
    this.activeObservation = null;
    for (const observation of this.pendingActiveObservations) observation.dispose();
    this.pendingActiveObservations.clear();

    // Destroy pane items before disposing their view owners.
    const items = this.workspace.getPaneItems().filter((item) => {
      const uri = item.getURI && item.getURI();
      return (
        uri === GIT_TAB_URI ||
        uri?.startsWith("lumine-git://patch/") ||
        uri === "lumine-git://debug/timings" ||
        uri === "lumine-git://debug/cache"
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
    await yardstick.flush();
  }

  consumeBusySignal(busySignal) {
    const owner = this.subscriptions,
      providers = this.busySignalProviders;
    const token = {};
    providers.set(token, busySignal);
    this.busySignal = busySignal;
    this.scheduleRerender();
    const lease = new Disposable(() => {
      owner.remove(lease);
      providers.delete(token);
      if (this.busySignalProviders !== providers) return;
      const current = [...providers.values()].at(-1) ?? null;
      if (current === this.busySignal) return;
      this.busySignal = current;
      this.scheduleRerender();
    });
    owner.add(lease);
    return lease;
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
      copyable: false,
      singletonKey: "git-panel:timings",
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
      copyable: false,
      singletonKey: "git-panel:git",
    });
    this.gitTabPaneItem = this.gitTabPaneItem || item;

    if (this.controller) this.scheduleRerender();
    return item;
  }

  createDockItemStub(options) {
    return GitPackage.prototype.createGitPaneItem.call(this, options);
  }

  createPatchPaneItem({ uri, deserialized = {} } = {}) {
    const documentModule = require("./models/patch-document");
    const PatchDocument = documentModule.default || documentModule;
    const document = PatchDocument.fromURI(uri);
    if (!document) throw new Error(`Invalid Git patch URI: ${uri}`);
    const item = PaneItemHost.create("git-patch", {
      classPrefix: "git-panel",
      title: document.getTitle(),
      iconName: document.getIconName(),
      uri,
      hydrationProps: deserialized,
      allowedLocations: CENTER_ONLY,
      serializeFallback: () => ({ deserializer: "PatchPaneItem", uri }),
      copyFactory: (options) =>
        GitPackage.prototype.copyPaneItemHost.call(this, "createPatchPaneItem", options),
    });
    if (this.controller) this.scheduleRerender();
    return item;
  }

  selectRepository = async (directory) => {
    await this.repositories.setActiveRepositoryForPath(directory, {
      pin: this.repositories.isActiveRepositoryPinned(),
    });
    await this.scheduleActiveContextUpdate({ usePath: directory, waitForRepository: true });
    if (this.activated) this.rerender();
  };

  createGitCachePaneItem({ uri, deserialized = {} } = {}) {
    return PaneItemHost.create("git-cache-view", {
      classPrefix: "git-panel",
      title: "Git Panel Cache View",
      uri,
      hydrationProps: deserialized,
      allowedLocations: CENTER_ONLY,
      serializeFallback: () => null,
      copyable: false,
      singletonKey: "git-panel:cache",
    });
  }

  copyPaneItemHost(factory, options) {
    options.signal?.throwIfAborted();
    if (this.activationDisposed || this.activated === false)
      throw new DOMException("Git Panel was unloaded", "AbortError");
    return GitPackage.prototype[factory].call(this, options);
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

  // Navigation is separate from the lazily loaded `git-panel.diff` renderer.
  provideGitPanel() {
    return createPanelService(this);
  }

  scheduleActiveContextUpdate(options = {}) {
    if (this.activationDisposed) {
      return Promise.resolve();
    }
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
      // Event listeners may schedule without awaiting the result. The original
      // promise still rejects for callers that need to handle the failure.
      this.activeContextUpdatePromise.catch(() => {});
    }
    return this.activeContextUpdatePromise;
  }

  async runActiveContextUpdates() {
    const generation = this.activationGeneration;
    try {
      while (
        generation === this.activationGeneration &&
        !this.activationDisposed &&
        this.pendingActiveContextOptions
      ) {
        const options = this.pendingActiveContextOptions;
        this.pendingActiveContextOptions = null;
        await this.updateActiveContext(options);
      }
    } catch (error) {
      if (generation === this.activationGeneration && !this.activationDisposed) {
        this.notificationManager.addWarning("Unable to refresh the active Git repository.", {
          detail: error.message,
          dismissable: true,
        });
      }
      throw error;
    } finally {
      if (generation === this.activationGeneration) {
        this.activeContextUpdatePromise = null;
      }
    }
  }

  async getNextContext(usePath = null, { waitForRepository = false } = {}) {
    const generation = this.activationGeneration;
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

    // Path discovery can outlive deactivation. It must not create repositories
    // in the context pool that teardown has already cleared, or use constructors
    // whose module generation has since been unloaded.
    if (generation !== this.activationGeneration || this.activationDisposed) {
      return null;
    }

    for (const workdir of workdirs) {
      this.contextPool.add(workdir);
    }

    if (usePath) {
      let useWorkdir;
      if (usePath === this.project.getPaths()[0]) {
        useWorkdir = firstProjectWorkdir;
      } else {
        useWorkdir = await workdirForPath(usePath);
      }

      if (generation !== this.activationGeneration || this.activationDisposed) {
        return null;
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
      return this.contextPool.getContext(activeWorkdir);
    }

    if (firstProjectWorkdir) {
      return this.contextPool.getContext(firstProjectWorkdir);
    }

    if (this.project.getPaths().length === 0) {
      return WorkdirContext.absent({ pipelineManager: this.pipelineManager });
    }

    return this.activeContext;
  }

  async setActiveContext(nextActiveContext) {
    const generation = this.activationGeneration;
    const directory = nextActiveContext.getWorkingDirectory();
    let observation = null;
    if (directory) {
      observation =
        this.activeObservation?.context === nextActiveContext
          ? this.activeObservation
          : this.contextPool.retain(directory);
      this.pendingActiveObservations.add(observation);
      try {
        // The cached model may have been idle while files or refs changed.
        // Do not expose it to mounted readers before the resume handshake.
        let ready;
        do {
          ready = observation.ready;
          await ready;
        } while (
          ready !== observation.ready &&
          generation === this.activationGeneration &&
          !this.activationDisposed
        );
      } catch (error) {
        if (observation !== this.activeObservation) observation.dispose();
        throw error;
      } finally {
        this.pendingActiveObservations.delete(observation);
      }
      nextActiveContext = observation.context;
    }
    if (generation !== this.activationGeneration || this.activationDisposed) {
      if (observation !== this.activeObservation) observation?.dispose();
      return;
    }
    const previousObservation = this.activeObservation;
    this.activeObservation = observation;
    if (previousObservation !== observation) previousObservation?.dispose();
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
    const generation = this.activationGeneration;
    if (this.activationDisposed || this.workspace.isDestroyed()) {
      return;
    }

    this.switchboard.didBeginActiveContextUpdate();

    const nextActiveContext = await this.getNextContext(options.usePath, options);
    if (nextActiveContext && generation === this.activationGeneration && !this.activationDisposed) {
      await this.setActiveContext(nextActiveContext);
    }
  }

  async refreshLumineGitRepository(workdir) {
    try {
      await refreshRepositoryForPath(this.repositories, workdir);
    } catch (_e) {}
  }
}
