/** @babel */
/** @jsx React.createElement */
import { CompositeDisposable, Disposable, Emitter } from "atom";

import path from "path";
import fs from "fs/promises";

import { autobind } from "./helpers";
import WorkdirCache from "./models/workdir-cache";
import WorkdirContext from "./models/workdir-context";
import WorkdirContextPool from "./models/workdir-context-pool";
import Repository from "./models/repository";
import StyleCalculator from "./models/style-calculator";
import StubItem from "./items/stub-item";
import Switchboard from "./switchboard";
import yardstick from "./yardstick";
import AsyncQueue from "./async-queue";
import getRepoPipelineManager from "./get-repo-pipeline-manager";
import {
  getRepositoryWorkingDirectory,
  refreshRepository,
  refreshRepositoryForPath,
  resolveRepositoryForPath,
} from "./repository-api";

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
    getLoadSettings,
    currentWindow,
    configDirPath,
    renderFn,
  }) {
    autobind(
      this,
      "consumeStatusBar",
      "createGitTimingsView",
      "createDockItemStub",
      "createFilePatchControllerStub",
      "destroyGitTabItem",
      "getRepositoryForWorkdir",
      "scheduleActiveContextUpdate",
    );

    this.workspace = workspace;
    this.project = project;
    if (!repositories) {
      throw new Error("git-panel requires the atom.repositories API");
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
    this.currentWindow = currentWindow;

    this.styleCalculator = new StyleCalculator(this.styles, this.config);
    this.confirm = confirm;
    this.activated = false;

    const criteria = {
      projectPathCount: this.project.getPaths().length,
      initPathCount: (getLoadSettings().initialPaths || []).length,
    };

    this.pipelineManager = getRepoPipelineManager({ confirm, notificationManager, workspace });

    this.activeContextQueue = new AsyncQueue();
    this.guessedContext = WorkdirContext.guess(criteria, this.pipelineManager);
    this.activeContext = this.guessedContext;
    this.startupContextPending = false;
    this.atomRepositoryWorkdirs = new WeakMap();
    for (const atomRepository of this.repositories.getRepositories()) {
      const workdir = getRepositoryWorkingDirectory(atomRepository);
      if (workdir) {
        this.atomRepositoryWorkdirs.set(atomRepository, workdir);
      }
    }
    this.workdirCache = new WorkdirCache();
    this.contextPool = new WorkdirContextPool({
      window,
      workspace,
      promptCallback: (query) => this.controller.openCredentialsDialog(query),
      pipelineManager: this.pipelineManager,
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

    // Handle events from all resident contexts.
    this.subscriptions = new CompositeDisposable(
      this.contextPool.onDidChangeWorkdirOrHead((context) => {
        this.refreshAtomGitRepository(context.getWorkingDirectory());
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

  async activate(state = {}) {
    const savedState = { ...defaultState, ...state };

    this.startOpenGitTab = this.config.get("git-panel.openGitTabOnStart");

    const hasSelectedFiles = (event) => {
      return !!event.target.closest(".git-panel-FilePatchListView").querySelector(".is-selected");
    };

    this.subscriptions.add(
      this.repositories.onDidChangeActiveRepository(this.handleActiveRepositoryChange),
      this.project.onDidChangePaths(this.handleProjectPathsChange),
      this.repositories.onDidAddRepository((atomRepo) => {
        const workdir = getRepositoryWorkingDirectory(atomRepo);
        this.workdirCache.invalidate();
        if (workdir) {
          this.atomRepositoryWorkdirs.set(atomRepo, workdir);
          this.contextPool.replace(workdir);
        }
        this.scheduleActiveContextUpdate();
      }),
      this.repositories.onDidRemoveRepository((atomRepo) => {
        const workdir = this.atomRepositoryWorkdirs.get(atomRepo);
        this.atomRepositoryWorkdirs.delete(atomRepo);
        this.workdirCache.invalidate();
        if (workdir) {
          this.contextPool.replace(workdir);
        }
        this.scheduleActiveContextUpdate();
      }),
      this.commands.add("atom-workspace", {
        "git-panel:update-repositories": async () => {
          this.workdirCache.invalidate();
          await this.repositories.rescan();
          await Promise.allSettled(this.repositories.getRepositories().map(refreshRepository));
          this.scheduleActiveContextUpdate();
        },
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
      atom.contextMenu.add({
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
    if (this.renderScheduled) {
      if (callback) {
        this.pendingRenderCallbacks = this.pendingRenderCallbacks || [];
        this.pendingRenderCallbacks.push(callback);
      }
      return;
    }

    this.renderScheduled = true;
    this.pendingRenderCallbacks = callback ? [callback] : [];

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
      // Restore the previous window's selection into atom.repositories before
      // deriving the panel context from it.
      if (usePath) {
        try {
          await this.repositories.setActiveRepositoryForPath(usePath, { pin: Boolean(lock) });
        } catch (_e) {}
      }
      if (!this.activated || this.workspace.isDestroyed()) {
        return;
      }
      // The restore has run; let the definitive update settle on the resolved
      // repository, or fall through to the empty view if there genuinely is none.
      this.startupContextPending = false;
      this.scheduleActiveContextUpdate({ usePath });
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
        currentWindow={this.currentWindow}
        workdirContextPool={this.contextPool}
        repository={this.getActiveRepository()}
        resolutionProgress={this.getActiveResolutionProgress()}
        statusBar={this.statusBar}
        initialize={this.initializeRepo}
        clone={this.clone}
        switchboard={this.switchboard}
        startOpenGitTab={this.startOpenGitTab}
        removeFilePatchItem={this.removeFilePatchItem}
        currentWorkDir={this.getActiveWorkdir()}
      />,
      this.element,
      callback,
    );
  }

  async deactivate() {
    this.activated = false;

    // Destroy all package pane items before unmounting the React tree
    const items = this.workspace.getPaneItems().filter((item) => {
      const uri = item.getURI && item.getURI();
      return uri && uri.startsWith("atom-github://");
    });
    for (const item of items) {
      const pane = this.workspace.paneForItem(item);
      if (pane) {
        pane.destroyItem(item);
      }
    }

    this.subscriptions.dispose();
    this.emitter.dispose();
    this.contextPool.clear();
    if (this.guessedContext) {
      this.guessedContext.destroy();
      this.guessedContext = null;
    }
    await yardstick.flush();
  }

  consumeStatusBar(statusBar) {
    this.statusBar = statusBar;
    this.scheduleRerender();
  }

  createGitTimingsView() {
    const TimingsView = getGitTimingsView();
    return StubItem.create(
      "git-timings-view",
      {
        title: "Git Panel Timings View",
      },
      TimingsView.buildURI(),
    );
  }

  createDockItemStub({ uri }) {
    if (uri !== "atom-github://dock-item/git") {
      throw new Error(`Invalid DockItem stub URI: ${uri}`);
    }

    const item = this.createGitStub(uri);
    this.gitTabStubItem = this.gitTabStubItem || item;

    if (this.controller) {
      this.scheduleRerender();
    }
    return item;
  }

  createGitStub(uri) {
    return StubItem.create(
      "git",
      {
        title: "Git",
      },
      uri,
    );
  }

  createFilePatchControllerStub({ uri } = {}) {
    const item = StubItem.create(
      "git-file-patch-controller",
      {
        title: "Diff",
      },
      uri,
    );
    if (this.controller) {
      this.scheduleRerender();
    }
    return item;
  }

  createCommitPreviewStub({ uri }) {
    const item = StubItem.create(
      "git-commit-preview",
      {
        title: "Commit preview",
      },
      uri,
    );
    if (this.controller) {
      this.scheduleRerender();
    }
    return item;
  }

  createCommitDetailStub({ uri }) {
    const item = StubItem.create(
      "git-commit-detail",
      {
        title: "Commit",
      },
      uri,
    );
    if (this.controller) {
      this.scheduleRerender();
    }
    return item;
  }

  destroyGitTabItem() {
    if (this.gitTabStubItem) {
      this.gitTabStubItem.destroy();
      this.gitTabStubItem = null;
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

    await this.refreshAtomGitRepository(projectPath);
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
      : this.contextPool.getContext(projectPath).getRepository();
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
    this.controller?.gitTabTracker?.toggleFocus();
  }

  openCloneDialog() {
    this.controller?.gitController?.openCloneDialog();
  }

  openInitializeDialog() {
    this.controller?.gitController?.openInitializeDialog();
  }

  onDidUpdate(cb) {
    return this.emitter.on("did-update", cb);
  }

  async scheduleActiveContextUpdate(options = {}) {
    this.switchboard.didScheduleActiveContextUpdate();
    await this.activeContextQueue.push(this.updateActiveContext.bind(this, options), {
      parallel: false,
    });
  }

  async getNextContext(usePath = null) {
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
      const atomRepository = await resolveRepositoryForPath(this.repositories, sourcePath);
      return (
        getRepositoryWorkingDirectory(atomRepository) ||
        (await this.workdirCache.find(sourcePath)) ||
        (await workdirForNonGitPath(sourcePath))
      );
    };

    const candidatePaths = new Set(this.project.getPaths());

    for (const atomRepository of this.repositories.getRepositories()) {
      const workdir = getRepositoryWorkingDirectory(atomRepository);
      if (workdir) {
        candidatePaths.add(workdir);
      }
    }
    // The window's active repository context is owned by atom.repositories; the
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

    this.contextPool.set(workdirs);

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
      let useWorkdir = usePath;
      if (usePath === this.project.getPaths()[0]) {
        useWorkdir = firstProjectWorkdir;
      } else {
        useWorkdir = await workdirForPath(usePath);
      }

      const stateContext = this.contextPool.getContext(useWorkdir);
      if (stateContext.isPresent()) {
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

    const nextActiveContext = await this.getNextContext(options.usePath);
    this.setActiveContext(nextActiveContext);
  }

  async refreshAtomGitRepository(workdir) {
    try {
      await refreshRepositoryForPath(this.repositories, workdir);
    } catch (_e) {}
  }
}
