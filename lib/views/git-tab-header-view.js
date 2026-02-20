/** @babel */
/** @jsx React.createElement */
import React from "react";
import path from "path";

import Octicon from "../atom/octicon";

export default class GitTabHeaderView extends React.Component {
  componentDidMount() {
    if (this.selectRef) {
      this.selectRef.addEventListener("wheel", this.handleWheel, { passive: false });
    }
  }

  componentWillUnmount() {
    if (this.selectRef) {
      this.selectRef.removeEventListener("wheel", this.handleWheel);
    }
  }

  render() {
    const lockIcon = this.props.contextLocked ? "lock" : "unlock";
    const lockToggleTitle = this.props.contextLocked
      ? "Change repository with the dropdown"
      : "Follow the active pane item";

    return (
      <header className="git-panel-Project">
        {this.renderCommitter()}
        <select
          ref={(el) => {
            this.selectRef = el;
          }}
          className="git-panel-Project-path input-select"
          value={this.props.workdir || ""}
          onChange={this.props.handleWorkDirSelect}
          disabled={this.props.changingWorkDir}
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

  handleWheel = (e) => {
    const select = e.currentTarget;
    const delta = e.deltaY > 0 ? 1 : -1;
    const nextIndex = select.selectedIndex + delta;
    if (nextIndex >= 0 && nextIndex < select.options.length) {
      select.selectedIndex = nextIndex;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    e.preventDefault();
  };

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
}
