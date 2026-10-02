/** @babel */
/** @jsx h */
import path from "path";

import { View, h } from "../etch/view";
import { CompositeDisposable } from "lumine";

import { nullAuthor } from "../models/author";
import GitTabHeaderView from "../views/git-tab-header-view";
import RefHolder from "../models/ref-holder";

const FOCUS_PROJECT = Symbol("project");

// The Git tab header: the committer avatar, the active-repository switcher, and
// the pin ("lock") toggle. Repository membership, the active selection, and the
// pin state all come from lumine.repositories, so the header mirrors the same
// active repository the status bar and every other consumer observe.
export default class GitTabHeaderController extends View {
  static focus = {
    PROJECT: FOCUS_PROJECT,
  };

  constructor(props, children) {
    super(props, children);
    this._isMounted = false;
    this._updateScheduled = false;
    this._committerRequest = 0;
    this.refView = new RefHolder();
    this.state = {
      committer: nullAuthor,
      changingLock: null,
      changingWorkDir: null,
      pendingWorkDir: null,
    };
    this.disposable = new CompositeDisposable();

    this.initialize();
  }

  didMount() {
    this._isMounted = true;
    this.subscribeToRepositories();
    this.updateCommitter();
  }

  subscribeToRepositories() {
    this.disposable.dispose();
    this.disposable = new CompositeDisposable(
      // The switcher's option list and the pin icon both follow the window's
      // repository registry rather than the panel's own workdir pool.
      lumine.repositories.onDidChange(() => this.scheduleUpdate()),
      lumine.repositories.observeActiveRepository(() => this.scheduleUpdate()),
      this.props.onDidUpdateRepo(this.updateCommitter),
    );
  }

  // Registry and active-repository notifications can arrive while an
  // asynchronous repository refresh or filesystem-watcher callback is
  // unwinding. Coalesce and defer every header refresh to a microtask so the view
  // never re-renders in the middle of that notification frame.
  scheduleUpdate() {
    if (this._updateScheduled || !this._isMounted) {
      return;
    }
    this._updateScheduled = true;
    Promise.resolve().then(() => {
      this._updateScheduled = false;
      if (this._isMounted) {
        this.invalidate();
      }
    });
  }

  render() {
    return h(
      "span",
      { style: { display: "contents" } },
      <GitTabHeaderView
        ref={this.refView.setter}
        committer={this.state.committer}
        // Workspace
        workdir={this.getWorkDir()}
        workdirs={this.getWorkDirs()}
        contextLocked={this.getLocked()}
        changingWorkDir={this.state.changingWorkDir !== null}
        changingLock={this.state.changingLock !== null}
        // Event Handlers
        handleAvatarClick={this.props.onDidClickAvatar}
        handleWorkDirSelect={this.handleWorkDirSelect}
        handleLockToggle={this.handleLockToggle}
      />,
    );
  }

  handleLockToggle = async () => {
    if (this.state.changingLock !== null) {
      return;
    }

    const active = lumine.repositories.getActiveRepository();
    if (!active) {
      return;
    }

    const nextLock = !lumine.repositories.isActiveRepositoryPinned();
    try {
      this.updateState({ changingLock: nextLock });
      // A locked selection stops following the active pane item; unlocking
      // resumes it. The registry owns the pin, so just retarget it here.
      lumine.repositories.setActiveRepository(active, { pin: nextLock });
    } finally {
      await this.updateState({ changingLock: null });
    }
  };

  handleWorkDirSelect = async (nextWorkDir) => {
    if (this.state.changingWorkDir !== null) {
      return;
    }

    try {
      this.updateState({ changingWorkDir: nextWorkDir, pendingWorkDir: nextWorkDir });
      // Preserve the pin so switching out of a locked selection keeps the new
      // repository locked instead of silently resuming pane-item following.
      await lumine.repositories.setActiveRepositoryForPath(nextWorkDir, {
        pin: lumine.repositories.isActiveRepositoryPinned(),
      });
    } finally {
      await this.updateState({ changingWorkDir: null });
    }
  };

  didUpdate(prevProps) {
    if (prevProps.onDidUpdateRepo !== this.props.onDidUpdateRepo) {
      this.subscribeToRepositories();
    }
    if (prevProps.getCommitter !== this.props.getCommitter) {
      this.updateCommitter();
    }
    if (this.state.pendingWorkDir !== null && this.isActiveWorkDir(this.state.pendingWorkDir)) {
      this.updateState({ pendingWorkDir: null });
    }
  }

  updateCommitter = async () => {
    const request = ++this._committerRequest;
    let committer;
    try {
      committer = (await this.props.getCommitter()) || nullAuthor;
    } catch (error) {
      if (!this._isMounted || request !== this._committerRequest) {
        return;
      }
      // The working directory can disappear while a tree-view move is still
      // unwinding. This background read must not leave an unhandled rejection
      // or retain the avatar for a repository that is no longer available.
      if (
        error.code === "ERR_GIT_REPOSITORY_UNAVAILABLE" ||
        error.code === "ERR_GIT_REPOSITORY_DESTROYED" ||
        error.code === "ABORT_ERR" ||
        error.name === "AbortError"
      ) {
        committer = nullAuthor;
      } else {
        console.error("Unable to refresh Git committer", error);
        return;
      }
    }
    if (!this._isMounted || request !== this._committerRequest) {
      return;
    }
    const prev = this.state.committer;
    if (
      prev &&
      prev.getEmail() === committer.getEmail() &&
      prev.getFullName() === committer.getFullName() &&
      prev.getAvatarUrl() === committer.getAvatarUrl()
    ) {
      return;
    }
    this.updateState({ committer });
  };

  getWorkDirs() {
    const workdirs = [];
    const seen = new Set();
    const add = (workdir) => {
      if (!workdir) {
        return;
      }
      const key = path.normalize(workdir);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      workdirs.push(workdir);
    };

    try {
      for (const repository of lumine.repositories.getRepositories()) {
        try {
          add(repository.getWorkingDirectory());
        } catch {
          // A repository destroyed mid-render has no working directory.
        }
      }
      // Include the active directory even when it is not a repository, so an
      // "initialize here" context still appears as the selected option.
      add(lumine.repositories.getActiveRepositoryContext().workingDirectory);
    } catch {
      // Never let a transient registry read throw out of render; the current
      // working directory alone keeps the switcher usable until the next tick.
      add(this.props.currentWorkDir);
    }
    return workdirs;
  }

  // The selected repository follows lumine.repositories directly, so switching
  // through git-center or by changing the active pane item updates the
  // dropdown immediately instead of waiting for the panel's active context
  // (currentWorkDir) to catch up on its own async schedule.
  getActiveWorkDir() {
    try {
      return (
        lumine.repositories.getActiveRepositoryContext().workingDirectory ||
        this.props.currentWorkDir
      );
    } catch {
      return this.props.currentWorkDir;
    }
  }

  isActiveWorkDir(workdir) {
    const active = this.getActiveWorkDir();
    return (
      Boolean(active) && Boolean(workdir) && path.normalize(active) === path.normalize(workdir)
    );
  }

  getWorkDir() {
    return this.state.changingWorkDir || this.state.pendingWorkDir || this.getActiveWorkDir();
  }

  getLocked() {
    if (this.state.changingLock !== null) {
      return this.state.changingLock;
    }
    try {
      return lumine.repositories.isActiveRepositoryPinned();
    } catch {
      return false;
    }
  }

  willDestroy() {
    this._isMounted = false;
    this.disposable.dispose();
  }

  getFocus(element) {
    return this.refView.map((view) => view.contains(element)).getOr(false)
      ? this.constructor.focus.PROJECT
      : null;
  }

  setFocus(focus) {
    if (focus !== this.constructor.focus.PROJECT) {
      return false;
    }

    return this.refView
      .map((view) => {
        view.focus();
        return true;
      })
      .getOr(false);
  }
}
