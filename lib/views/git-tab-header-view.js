/** @babel */
/** @jsx React.createElement */
import React from "react";
import path from "path";

import Octicon from "../atom/octicon";

export default class GitTabHeaderView extends React.Component {
  componentDidMount() {
    if (this.selectRef) {
      this.selectRef.addEventListener("wheel", this.handleWheel, { passive: false });
      this.syncSelectValue();
    }
  }

  componentDidUpdate() {
    this.syncSelectValue();
  }

  componentWillUnmount() {
    if (this.selectRef) {
      this.selectRef.removeEventListener("wheel", this.handleWheel);
    }
  }

  syncSelectValue() {
    if (!this.selectRef) {
      return;
    }
    const desired = this.getCurrentWorkDir();
    if (this.selectRef.value !== desired) {
      this.selectRef.value = desired;
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
        <select
          ref={(el) => {
            this.selectRef = el;
          }}
          className="git-panel-Project-path input-select"
          defaultValue={this.getCurrentWorkDir()}
          onChange={this.handleWorkDirSelect}
          onKeyDown={this.handleKeyDown}
        >
          {this.renderWorkDirs()}
        </select>
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
    const select = event.currentTarget;
    const delta = event.deltaY > 0 ? 1 : -1;
    const nextIndex = select.selectedIndex + delta;

    if (nextIndex >= 0 && nextIndex < select.options.length) {
      event.preventDefault();
      this.props.handleWorkDirSelect(select.options[nextIndex].value);
    }
  };

  handleWorkDirSelect = (event) => {
    this.props.handleWorkDirSelect(event.target.value);
  };

  handleKeyDown = (event) => {
    const select = event.currentTarget;
    const count = select.options.length;
    if (count === 0) {
      return;
    }

    const selectAt = (index) => {
      if (index < 0 || index >= count || index === select.selectedIndex) {
        return;
      }
      event.preventDefault();
      this.props.handleWorkDirSelect(select.options[index].value);
    };

    switch (event.key) {
      case "ArrowUp":
      case "ArrowDown":
        if (typeof select.showPicker === "function") {
          event.preventDefault();
          try {
            select.showPicker();
          } catch (_e) {
            // showPicker can throw if the element is not in a user-activation context
          }
        }
        return;
      case "ArrowLeft":
        selectAt(select.selectedIndex - 1);
        return;
      case "ArrowRight":
        selectAt(select.selectedIndex + 1);
        return;
      case "Home":
        selectAt(0);
        return;
      case "End":
        selectAt(count - 1);
        return;
      default:
    }
  };

  getCurrentWorkDir() {
    return this.props.workdir ? path.normalize(this.props.workdir) : "";
  }

  renderWorkDirs() {
    const workdirs = [];
    for (const workdir of this.props.workdirs) {
      workdirs.push(
        <option key={workdir} value={path.normalize(workdir)}>
          {path.basename(workdir)}
        </option>,
      );
    }
    return workdirs;
  }

  renderCommitter() {
    const email = this.props.committer.getEmail();
    const avatarUrl = this.props.committer.getAvatarUrl();
    const name = this.props.committer.getFullName();

    return (
      <button className="git-panel-Project-avatarBtn" onClick={this.props.handleAvatarClick}>
        <img
          className="git-panel-Project-avatar"
          src={avatarUrl || "atom://git-panel/img/avatar.svg"}
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
    if (this.selectRef && !this.selectRef.disabled) {
      this.selectRef.focus();
    } else if (this.rootRef) {
      this.rootRef.focus();
    }
  }
}
