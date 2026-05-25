/** @babel */
/** @jsx React.createElement */
import React from "react";
import { CompositeDisposable } from "atom";
import { nullAuthor } from "../models/author";
import GitTabHeaderView from "../views/git-tab-header-view";
import RefHolder from "../models/ref-holder";

const FOCUS_PROJECT = Symbol("project");

export default class GitTabHeaderController extends React.Component {
  static focus = {
    PROJECT: FOCUS_PROJECT,
  };

  constructor(props) {
    super(props);
    this._isMounted = false;
    this.refView = new RefHolder();
    this.state = {
      currentWorkDirs: [],
      committer: nullAuthor,
      changingLock: null,
      changingWorkDir: null,
      pendingWorkDir: null,
    };
    this.disposable = new CompositeDisposable();
  }

  static getDerivedStateFromProps(props, state) {
    const next = Array.from(props.getCurrentWorkDirs());
    const prev = state.currentWorkDirs;
    if (prev && prev.length === next.length && prev.every((v, i) => v === next[i])) {
      return null;
    }
    return { currentWorkDirs: next };
  }

  componentDidMount() {
    this._isMounted = true;
    this.disposable.add(this.props.onDidChangeWorkDirs(this.resetWorkDirs));
    this.disposable.add(this.props.onDidUpdateRepo(this.updateCommitter));
    this.updateCommitter();
  }

  render() {
    return (
      <GitTabHeaderView
        ref={this.refView.setter}
        committer={this.state.committer}
        // Workspace
        workdir={this.getWorkDir()}
        workdirs={this.state.currentWorkDirs}
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

    const nextLock = !this.props.contextLocked;
    try {
      this.setState({ changingLock: nextLock });
      await this.props.setContextLock(this.getWorkDir(), nextLock);
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
      await this.props.changeWorkingDirectory(nextWorkDir);
    } finally {
      await new Promise((resolve) => this.setState({ changingWorkDir: null }, resolve));
    }
  };

  componentDidUpdate(prevProps) {
    if (
      prevProps.onDidChangeWorkDirs !== this.props.onDidChangeWorkDirs ||
      prevProps.onDidUpdateRepo !== this.props.onDidUpdateRepo
    ) {
      this.disposable.dispose();
      this.disposable = new CompositeDisposable();
      this.disposable.add(this.props.onDidChangeWorkDirs(this.resetWorkDirs));
      this.disposable.add(this.props.onDidUpdateRepo(this.updateCommitter));
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

  resetWorkDirs = () => {
    this.setState(() => ({
      currentWorkDirs: [],
    }));
  };

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

  getWorkDir() {
    return this.state.changingWorkDir || this.state.pendingWorkDir || this.props.currentWorkDir;
  }

  getLocked() {
    return this.state.changingLock !== null ? this.state.changingLock : this.props.contextLocked;
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
