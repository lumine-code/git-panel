/** @babel */
/** @jsx React.createElement */
import path from "path";

import React from "react";
import { CompositeDisposable } from "atom";

import { nullAuthor } from "../models/author";
import GitTabHeaderView from "../views/git-tab-header-view";
import RefHolder from "../models/ref-holder";

const FOCUS_PROJECT = Symbol("project");

// The Git tab header: the committer avatar, the active-repository switcher, and
// the pin ("lock") toggle. Repository membership, the active selection, and the
// pin state all come from atom.repositories, so the header mirrors the same
// active repository the status bar and every other consumer observe.
export default class GitTabHeaderController extends React.Component {
  static focus = {
    PROJECT: FOCUS_PROJECT,
  };

  constructor(props) {
    super(props);
    this._isMounted = false;
    this._updateScheduled = false;
    this.refView = new RefHolder();
    this.state = {
      committer: nullAuthor,
      changingLock: null,
      changingWorkDir: null,
      pendingWorkDir: null,
    };
    this.disposable = new CompositeDisposable();
  }

  componentDidMount() {
    this._isMounted = true;
    this.subscribeToRepositories();
    this.updateCommitter();
  }

  subscribeToRepositories() {
    this.disposable.dispose();
    this.disposable = new CompositeDisposable(
      // The switcher's option list and the pin icon both follow the window's
      // repository registry rather than the panel's own workdir pool.
      atom.repositories.onDidChange(() => this.scheduleUpdate()),
      atom.repositories.observeActiveRepository(() => this.scheduleUpdate()),
      this.props.onDidUpdateRepo(this.updateCommitter),
    );
  }

  // Registry and active-repository notifications can arrive synchronously from
  // inside a native git-utils async-worker completion (a repository's status
  // callback) or a filesystem-watcher callback. Re-rendering React in that
  // frame can unwind through the native call and fatally crash the renderer, so
  // coalesce and defer every header refresh to a microtask.
  scheduleUpdate() {
    if (this._updateScheduled || !this._isMounted) {
      return;
    }
    this._updateScheduled = true;
    Promise.resolve().then(() => {
      this._updateScheduled = false;
      if (this._isMounted) {
        this.forceUpdate();
      }
    });
  }

  render() {
    return (
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
      />
    );
  }

  handleLockToggle = async () => {
    if (this.state.changingLock !== null) {
      return;
    }

    const active = atom.repositories.getActiveRepository();
    if (!active) {
      return;
    }

    const nextLock = !atom.repositories.isActiveRepositoryPinned();
    try {
      this.setState({ changingLock: nextLock });
      // A locked selection stops following the active pane item; unlocking
      // resumes it. The registry owns the pin, so just retarget it here.
      atom.repositories.setActiveRepository(active, { pin: nextLock });
    } finally {
      await new Promise((resolve) => this.setState({ changingLock: null }, resolve));
    }
  };

  handleWorkDirSelect = async (nextWorkDir) => {
    if (this.state.changingWorkDir !== null) {
      return;
    }

    try {
      this.setState({ changingWorkDir: nextWorkDir, pendingWorkDir: nextWorkDir });
      // Preserve the pin so switching out of a locked selection keeps the new
      // repository locked instead of silently resuming pane-item following.
      await atom.repositories.setActiveRepositoryForPath(nextWorkDir, {
        pin: atom.repositories.isActiveRepositoryPinned(),
      });
    } finally {
      await new Promise((resolve) => this.setState({ changingWorkDir: null }, resolve));
    }
  };

  componentDidUpdate(prevProps) {
    if (prevProps.onDidUpdateRepo !== this.props.onDidUpdateRepo) {
      this.subscribeToRepositories();
    }
    if (prevProps.getCommitter !== this.props.getCommitter) {
      this.updateCommitter();
    }
    if (
      this.state.pendingWorkDir !== null &&
      this.props.currentWorkDir === this.state.pendingWorkDir
    ) {
      this.setState({ pendingWorkDir: null });
    }
  }

  updateCommitter = async () => {
    const committer = (await this.props.getCommitter()) || nullAuthor;
    if (!this._isMounted) {
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
    this.setState({ committer });
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
      for (const repository of atom.repositories.getRepositories()) {
        try {
          add(repository.getWorkingDirectory());
        } catch {
          // A repository destroyed mid-render has no working directory.
        }
      }
      // Include the active directory even when it is not a repository, so an
      // "initialize here" context still appears as the selected option.
      add(atom.repositories.getActiveRepositoryContext().workingDirectory);
    } catch {
      // Never let a transient registry read throw out of render; the current
      // working directory alone keeps the switcher usable until the next tick.
      add(this.props.currentWorkDir);
    }
    return workdirs;
  }

  getWorkDir() {
    return this.state.changingWorkDir || this.state.pendingWorkDir || this.props.currentWorkDir;
  }

  getLocked() {
    if (this.state.changingLock !== null) {
      return this.state.changingLock;
    }
    try {
      return atom.repositories.isActiveRepositoryPinned();
    } catch {
      return false;
    }
  }

  componentWillUnmount() {
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
