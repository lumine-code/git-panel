/** @babel */
/** @jsx React.createElement */
import React from "react";
import path from "path";

import Octicon from "../lumine/octicon";
import SelectBox from "./select-box";

// Accumulate wheel deltas so a trackpad doesn't skip several repositories per
// event, then commit the (async) switch once the gesture fully settles. The
// commit is deferred until the wheel goes quiet so scrolling *through* a large
// repository never selects (and loads) it — only stopping on one does.
const WHEEL_STEP_THRESHOLD = 60;
const WHEEL_COMMIT_DELAY = 200;

export default class GitTabHeaderView extends React.Component {
  constructor(props) {
    super(props);
    this.wheelAccumulator = 0;
    this.wheelPreviewWorkDir = null;
    this.wheelCommitTimeout = null;
  }

  componentDidMount() {
    if (this.selectRef) {
      this.selectRef.element.addEventListener("wheel", this.handleWheel, { passive: false });
      this.syncSelectValue();
    }
  }

  componentDidUpdate() {
    this.syncSelectValue();
  }

  componentWillUnmount() {
    if (this.selectRef) {
      this.selectRef.element.removeEventListener("wheel", this.handleWheel);
    }
    if (this.wheelCommitTimeout) {
      clearTimeout(this.wheelCommitTimeout);
    }
  }

  syncSelectValue() {
    if (!this.selectRef) {
      return;
    }
    // While a wheel gesture is choosing a repository, keep its previewed option
    // selected instead of snapping back to the active repository mid-gesture.
    const desired = this.wheelPreviewWorkDir ?? this.getCurrentWorkDir();
    if (this.selectRef.value !== desired) {
      this.selectRef.setValue(desired);
    }
  }

  render() {
    const lockIcon = this.props.contextLocked ? "lock" : "unlock";
    const lockToggleTitle = this.props.contextLocked
      ? "Change repository with the dropdown"
      : "Follow the active pane item";

    return (
      <header
        className="git-panel-Project"
        ref={(el) => {
          this.rootRef = el;
        }}
        tabIndex="-1"
      >
        {this.renderCommitter()}
        <SelectBox
          ref={(el) => {
            this.selectRef = el;
          }}
          className="git-panel-Project-path"
          ariaLabel="Repository"
          value={this.getCurrentWorkDir()}
          disabled={this.props.changingWorkDir}
          onDidChange={this.handleWorkDirSelect}
          items={this.renderWorkDirs()}
        />
        <button
          className="git-panel-Project-lock btn btn-small"
          onClick={this.props.handleLockToggle}
          disabled={this.props.changingLock}
          title={lockToggleTitle}
        >
          <Octicon icon={lockIcon} />
        </button>
      </header>
    );
  }

  handleWheel = (event) => {
    if (!this.selectRef?.element || this.selectRef.element.disabled) {
      return;
    }
    const items = this.selectRef?.items || [];
    if (items.length === 0) {
      return;
    }
    // The picker is the repository switcher, so take over its wheel entirely
    // rather than stepping the value per raw event.
    event.preventDefault();

    this.wheelAccumulator += event.deltaY;
    if (Math.abs(this.wheelAccumulator) >= WHEEL_STEP_THRESHOLD) {
      const direction = this.wheelAccumulator > 0 ? 1 : -1;
      this.wheelAccumulator = 0;

      const currentIndex =
        this.wheelPreviewWorkDir != null
          ? items.findIndex((item) => item.value === this.wheelPreviewWorkDir)
          : items.findIndex((item) => item.value === this.selectRef.value);
      const nextIndex = currentIndex + direction;
      if (nextIndex >= 0 && nextIndex < items.length) {
        // Preview the option immediately for responsiveness; the switch itself
        // is deferred until the gesture stops.
        const nextValue = items[nextIndex].value;
        this.wheelPreviewWorkDir = nextValue;
        this.selectRef.setValue(nextValue);
      }
    }

    // Re-arm the commit on every wheel event (not only when the preview steps),
    // so continuous scrolling — even sub-threshold nudges — keeps deferring the
    // switch until the wheel is truly idle.
    if (this.wheelPreviewWorkDir != null) {
      this.scheduleWheelCommit();
    }
  };

  scheduleWheelCommit() {
    if (this.wheelCommitTimeout) {
      clearTimeout(this.wheelCommitTimeout);
    }
    this.wheelCommitTimeout = setTimeout(() => {
      this.wheelCommitTimeout = null;
      const target = this.wheelPreviewWorkDir;
      this.wheelPreviewWorkDir = null;
      if (target != null && target !== this.getCurrentWorkDir()) {
        this.props.handleWorkDirSelect(target);
      } else {
        // Landed back on the active repository (or nothing to do): drop the
        // preview and restore the real selection instead of reloading it.
        this.syncSelectValue();
      }
    }, WHEEL_COMMIT_DELAY);
  }

  handleWorkDirSelect = ({ value }) => {
    this.props.handleWorkDirSelect(value);
  };

  getCurrentWorkDir() {
    return this.props.workdir ? path.normalize(this.props.workdir) : "";
  }

  renderWorkDirs() {
    return this.props.workdirs.map((workdir) => ({
      value: path.normalize(workdir),
      label: path.basename(workdir),
    }));
  }

  renderCommitter() {
    const email = this.props.committer.getEmail();
    const avatarUrl = this.props.committer.getAvatarUrl();
    const name = this.props.committer.getFullName();

    return (
      <button className="git-panel-Project-avatarBtn" onClick={this.props.handleAvatarClick}>
        <img
          className="git-panel-Project-avatar"
          src={avatarUrl || "lumine://git-panel/img/avatar.svg"}
          title={`${name} ${email}`}
          alt={`${name}'s avatar`}
        />
      </button>
    );
  }

  contains(element) {
    return this.rootRef && this.rootRef.contains(element);
  }

  focus() {
    if (this.selectRef?.element && !this.selectRef.element.disabled) {
      this.selectRef.focus();
    } else if (this.rootRef) {
      this.rootRef.focus();
    }
  }
}
