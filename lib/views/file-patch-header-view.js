/** @babel */
/** @jsx h */
import path from "path";

import { View, h, Fragment } from "../etch/view.js";
import cx from "classnames";

import Octicon from "../lumine/octicon.js";

export default class FilePatchHeaderView extends View {
  constructor(props, children) {
    super(props, children);

    this.initialize();
  }

  render() {
    return (
      <header className="git-panel-FilePatchView-header" tabIndex="-1">
        {this.renderCollapseButton()}
        <span className="git-panel-FilePatchView-title">{this.renderTitle()}</span>
        {this.renderButtons()}
      </header>
    );
  }

  togglePatchCollapse = () => {
    if (this.props.isCollapsed) {
      this.props.triggerExpand();
    } else {
      this.props.triggerCollapse();
    }
  };

  renderCollapseButton() {
    if (this.props.surfaceKind === "file") {
      return null;
    }
    const icon = this.props.isCollapsed ? "chevron-right" : "chevron-down";
    return (
      <button
        type="button"
        className="git-panel-FilePatchView-collapseButton"
        attributes={{
          "aria-label": this.props.isCollapsed ? "Expand file changes" : "Collapse file changes",
          "aria-expanded": String(!this.props.isCollapsed),
        }}
        onClick={this.togglePatchCollapse}
      >
        <Octicon className="git-panel-FilePatchView-collapseButtonIcon" icon={icon} />
      </button>
    );
  }

  renderTitle() {
    if (this.props.surfaceKind === "file") {
      const status = this.props.stagingStatus;
      return (
        <span>
          {status[0].toUpperCase()}
          {status.slice(1)} Changes for {this.renderDisplayPath()}
        </span>
      );
    } else {
      return this.renderDisplayPath();
    }
  }

  renderDisplayPath() {
    if (this.props.newPath && this.props.newPath !== this.props.relPath) {
      const oldPath = this.renderPath(this.props.relPath);
      const newPath = this.renderPath(this.props.newPath);
      return (
        <span>
          {oldPath} <span>→</span> {newPath}
        </span>
      );
    } else {
      return this.renderPath(this.props.relPath);
    }
  }

  renderPath(filePath) {
    if (typeof filePath !== "string") {
      return null;
    }
    const dirname = path.dirname(filePath);
    const basename = path.basename(filePath);

    if (dirname === ".") {
      return <span className="git-panel-FilePatchHeaderView-basename">{basename}</span>;
    } else {
      return (
        <span>
          {dirname}
          {path.sep}
          <span className="git-panel-FilePatchHeaderView-basename">{basename}</span>
        </span>
      );
    }
  }

  renderButtons() {
    if (this.props.readOnly || this.props.surfaceKind === "commit") {
      return null;
    } else {
      return (
        <Fragment>
          {this.renderUndoDiscardButton()}
          {this.renderMirrorPatchButton()}
          {this.renderOpenFileButton()}
          {this.renderToggleFileButton()}
        </Fragment>
      );
    }
  }

  renderUndoDiscardButton() {
    const unstagedFileDocument =
      this.props.surfaceKind === "file" && this.props.stagingStatus === "unstaged";
    if (unstagedFileDocument && this.props.hasUndoHistory) {
      return (
        <button
          className="git-panel-DiffHeaderButton git-panel-FilePatchHeaderView-button icon icon-history"
          onClick={this.props.undoLastDiscard}
        >
          Undo Discard
        </button>
      );
    } else {
      return null;
    }
  }

  renderMirrorPatchButton() {
    if (!this.props.isPartiallyStaged) {
      return null;
    }

    const attrs =
      this.props.stagingStatus === "unstaged"
        ? {
            iconClass: "icon-tasklist",
            buttonText: "View Staged",
          }
        : {
            iconClass: "icon-list-unordered",
            buttonText: "View Unstaged",
          };

    return (
      <button
        className={cx(
          "git-panel-DiffHeaderButton",
          "git-panel-FilePatchHeaderView-button",
          "icon",
          attrs.iconClass,
        )}
        onClick={this.props.diveIntoMirrorPatch}
      >
        {attrs.buttonText}
      </button>
    );
  }

  renderOpenFileButton() {
    let buttonText = "Jump To File";
    if (this.props.hasMultipleFileSelections) {
      buttonText += "s";
    }

    return (
      <button
        className="git-panel-DiffHeaderButton git-panel-FilePatchHeaderView-button icon icon-code git-panel-FilePatchHeaderView-jumpToFileButton"
        onClick={this.props.openFile}
      >
        {buttonText}
      </button>
    );
  }

  renderToggleFileButton() {
    const attrs =
      this.props.stagingStatus === "unstaged"
        ? {
            buttonClass: "icon-move-down",
            buttonText: "Stage File",
          }
        : {
            buttonClass: "icon-move-up",
            buttonText: "Unstage File",
          };

    return (
      <button
        className={cx(
          "git-panel-DiffHeaderButton",
          "git-panel-FilePatchHeaderView-button",
          "icon",
          attrs.buttonClass,
        )}
        onClick={this.props.toggleFile}
      >
        {attrs.buttonText}
      </button>
    );
  }
}
