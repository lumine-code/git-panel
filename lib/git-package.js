/** @babel */
/** @jsx React.createElement */
import { CompositeDisposable, Disposable, Emitter } from "atom";

import path from "path";
import fs from "fs/promises";

import React from "react";
import { createRoot } from "react-dom/client";

import { autobind } from "./helpers";
import WorkdirCache from "./models/workdir-cache";
import WorkdirContext from "./models/workdir-context";
import WorkdirContextPool from "./models/workdir-context-pool";
import Repository from "./models/repository";
import StyleCalculator from "./models/style-calculator";
import RootController from "./controllers/root-controller";
import StubItem from "./items/stub-item";
import Switchboard from "./switchboard";
import yardstick from "./yardstick";
import GitTimingsView from "./views/git-timings-view";
import ContextMenuInterceptor from "./context-menu-interceptor";
import AsyncQueue from "./async-queue";
import getRepoPipelineManager from "./get-repo-pipeline-manager";

const defaultState = {
  newProject: true,
  activeRepositoryPath: null,
  contextLocked: false,
};

export default class GitPackage {
  constructor({
    workspace,
    project,
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
    this.lockedContext = null;
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
      this.contextPool.onDidDestroyRepository((context) => {
        if (context === this.activeContext) {
          this.setActiveContext(WorkdirContext.absent({ pipelineManager: this.pipelineManager }));
        }
      }),
      ContextMenuInterceptor,
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
    atom.packages.disablePackage("github");

    const savedState = { ...defaultState, ...state };

    this.startOpenGitTab = this.config.get("git-panel.openGitTabOnStart");

    const hasSelectedFiles = (event) => {
      return !!event.target.closest(".git-panel-FilePatchListView").querySelector(".is-selected");
    };

    this.subscriptions.add(
      this.workspace.getCenter().onDidChangeActivePaneItem(this.handleActivePaneItemChange),
      this.project.onDidChangePaths(this.handleProjectPathsChange),
      this.config.onDidChange("git-panel.projectScanDepth", this.handleScanDepthChange),
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
    this.scheduleActiveContextUpdate({
      usePath: savedState.activeRepositoryPath,
      lock: savedState.contextLocked,
    });
    this.rerender();
  }

  handleActivePaneItemChange = () => {
    if (this.lockedContext) {
      return;
    }

    const itemPath = pathForPaneItem(this.workspace.getCenter().getActivePaneItem());
    this.scheduleActiveContextUpdate({
      usePath: itemPath,
      lock: false,
    });
  };

  handleProjectPathsChange = () => {
    this.scheduleActiveContextUpdate();
  };

  handleScanDepthChange = () => {
    this.scheduleActiveContextUpdate();
  };

  serialize() {
    return {
      activeRepositoryPath: this.getActiveWorkdir(),
      contextLocked: Boolean(this.lockedContext),
      newProject: false,
    };
  }

  rerender(callback) {
    if (this.workspace.isDestroyed()) {
      return;
    }

    if (!this.activated) {
      return;
    }

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

    const changeWorkingDirectory = (workingDirectory) => {
      return this.scheduleActiveContextUpdate({ usePath: workingDirectory });
    };

    const setContextLock = (workingDirectory, lock) => {
      return this.scheduleActiveContextUpdate({ usePath: workingDirectory, lock });
    };

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
        contextLocked={this.lockedContext !== null}
        changeWorkingDirectory={changeWorkingDirectory}
        setContextLock={setContextLock}
      />,
      this.element,
      callback,
    );
  }

  async deactivate() {
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
    this.rerender();
  }

  createGitTimingsView() {
    return StubItem.create(
      "git-timings-view",
      {
        title: "Git Panel Timings View",
      },
      GitTimingsView.buildURI(),
    );
  }

  createDockItemStub({ uri }) {
    if (uri !== "atom-github://dock-item/git") {
      throw new Error(`Invalid DockItem stub URI: ${uri}`);
    }

    const item = this.createGitStub(uri);
    this.gitTabStubItem = this.gitTabStubItem || item;

    if (this.controller) {
      this.rerender();
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
      this.rerender();
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
      this.rerender();
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
      this.rerender();
    }
    return item;
  }

  destroyGitTabItem() {
    if (this.gitTabStubItem) {
      this.gitTabStubItem.destroy();
      this.gitTabStubItem = null;
      if (this.controller) {
        this.rerender();
      }
    }
  }

  initializeRepo = async (projectPath) => {
    await fs.mkdir(projectPath, { recursive: true });

    const repository = this.contextPool.add(projectPath).getRepository();
    await repository.init();
    this.workdirCache.invalidate();

    if (!this.project.contains(projectPath)) {
      this.project.addPath(projectPath);
    }

    await this.refreshAtomGitRepository(projectPath);
    await this.scheduleActiveContextUpdate();
  };

  clone = async (remoteUrl, projectPath, sourceRemoteName = "origin") => {
    const context = this.contextPool.getContext(projectPath);
    let repository;
    if (context.isPresent()) {
      repository = context.getRepository();
      await repository.clone(remoteUrl, sourceRemoteName);
      repository.destroy();
    } else {
      repository = new Repository(projectPath, null, { pipelineManager: this.pipelineManager });
      await repository.clone(remoteUrl, sourceRemoteName);
    }

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
    return this.lockedContext !== null;
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
      return (
        await Promise.all([this.workdirCache.find(sourcePath), workdirForNonGitPath(sourcePath)])
      ).find(Boolean);
    };

    const scanDepth = this.config.get("git-panel.projectScanDepth") || 0;
    const scanForGitRepos = async (dir, depth) => {
      if (depth <= 0) {
        return [];
      }
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const repos = [];
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) {
            continue;
          }
          const fullPath = path.join(dir, entry.name);
          try {
            await fs.access(path.join(fullPath, ".git"));
            repos.push(fullPath);
          } catch (_e) {
            if (depth > 1) {
              repos.push(...(await scanForGitRepos(fullPath, depth - 1)));
            }
          }
        }
        return repos;
      } catch (_e) {
        return [];
      }
    };

    const candidatePaths = new Set(this.project.getPaths());

    if (scanDepth > 0) {
      const nested = await Promise.all(
        this.project.getPaths().map((p) => scanForGitRepos(p, scanDepth)),
      );
      for (const repos of nested) {
        for (const repo of repos) {
          candidatePaths.add(repo);
        }
      }
    }
    if (this.lockedContext) {
      const lockedRepo = this.lockedContext.getRepository();
      if (lockedRepo) {
        candidatePaths.add(lockedRepo.getWorkingDirectoryPath());
      }
    }
    const activeItemPath = pathForPaneItem(this.workspace.getCenter().getActivePaneItem());
    if (activeItemPath) {
      candidatePaths.add(activeItemPath);
    }

    let activeItemWorkdir = null;
    let firstProjectWorkdir = null;

    const workdirs = new Set(
      await Promise.all(
        Array.from(candidatePaths, async (candidatePath) => {
          const workdir = await workdirForPath(candidatePath);

          if (candidatePath === activeItemPath) {
            activeItemWorkdir = workdir;
          } else if (candidatePath === this.project.getPaths()[0]) {
            firstProjectWorkdir = workdir;
          }

          return workdir;
        }),
      ),
    );

    this.contextPool.set(workdirs);

    if (usePath) {
      let useWorkdir = usePath;
      if (usePath === activeItemPath) {
        useWorkdir = activeItemWorkdir;
      } else if (usePath === this.project.getPaths()[0]) {
        useWorkdir = firstProjectWorkdir;
      } else {
        useWorkdir = await workdirForPath(usePath);
      }

      const stateContext = this.contextPool.getContext(useWorkdir);
      if (stateContext.isPresent()) {
        return stateContext;
      }
    }

    if (this.lockedContext) {
      return this.lockedContext;
    }

    if (activeItemWorkdir) {
      return this.contextPool.getContext(activeItemWorkdir);
    }

    if (firstProjectWorkdir) {
      return this.contextPool.getContext(firstProjectWorkdir);
    }

    if (
      this.project.getPaths().length === 0 &&
      !this.activeContext.getRepository().isUndetermined()
    ) {
      return WorkdirContext.absent({ pipelineManager: this.pipelineManager });
    }

    return this.activeContext;
  }

  setActiveContext(nextActiveContext, lock) {
    if (nextActiveContext !== this.activeContext) {
      if (this.activeContext === this.guessedContext) {
        this.guessedContext.destroy();
        this.guessedContext = null;
      }
      this.activeContext = nextActiveContext;
      if (lock === true) {
        this.lockedContext = this.activeContext;
      } else if (lock === false) {
        this.lockedContext = null;
      }

      this.rerender(() => {
        this.switchboard.didFinishContextChangeRender();
        this.switchboard.didFinishActiveContextUpdate();
      });
      this.emitter.emit("did-update");
    } else if ((lock === true || lock === false) && lock !== (this.lockedContext !== null)) {
      if (lock) {
        this.lockedContext = this.activeContext;
      } else {
        this.lockedContext = null;
      }

      this.rerender(() => {
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
    this.setActiveContext(nextActiveContext, options.lock);
  }

  async refreshAtomGitRepository(workdir) {
    const directory = this.project.getDirectoryForProjectPath(workdir);
    if (!directory) {
      return;
    }

    const atomGitRepo = await this.project.repositoryForDirectory(directory);
    if (atomGitRepo) {
      await atomGitRepo.refreshStatus();
    }
  }
}

function pathForPaneItem(paneItem) {
  if (!paneItem) {
    return null;
  }

  if (typeof paneItem.getWorkingDirectory === "function") {
    return paneItem.getWorkingDirectory();
  }

  if (typeof paneItem.getPath === "function") {
    return paneItem.getPath();
  }

  return null;
}
