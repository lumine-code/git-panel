/** @babel */
/** @jsx h */
import { View, h, Fragment } from "../etch/view";
import cx from "classnames";

import { autobind } from "../helpers";
import RefHolder from "../models/ref-holder";
import Tooltip from "../lumine/tooltip";
import Keystroke from "../lumine/keystroke";
import hunkTitle from "../hunk-title";

function theBuckStopsHere(event) {
  event.stopPropagation();
}

export default class HunkHeaderView extends View {
  constructor(props, children) {
    super(props, children);
    autobind(this, "didMouseDown", "renderButtons");

    this.refDiscardButton = new RefHolder();
    this.refCopyButton = new RefHolder();

    this.initialize();
  }

  render() {
    const conditional = {
      "git-panel-HunkHeaderView--isSelected": this.props.isSelected,
      "git-panel-HunkHeaderView--isHunkMode": this.props.selectionMode === "hunk",
    };

    return (
      <div className={cx("git-panel-HunkHeaderView", conditional)} onMouseDown={this.didMouseDown}>
        <span className="git-panel-HunkHeaderView-title">
          {hunkTitle(this.props.hunk.getSummary())}
        </span>
        {this.renderButtons()}
      </div>
    );
  }

  renderButtons() {
    const editable = !this.props.readOnly && this.props.surfaceKind !== "commit";
    return (
      <Fragment>
        {editable && (
          <button
            className="git-panel-HunkHeaderView-stageButton"
            onClick={this.props.toggleSelection}
            onMouseDown={theBuckStopsHere}
          >
            <Keystroke
              keymaps={this.props.keymaps}
              command="core:confirm"
              refTarget={this.props.refTarget}
            />
            {this.props.toggleSelectionLabel}
          </button>
        )}
        <button
          ref={this.refCopyButton.setter}
          className="icon-clippy git-panel-HunkHeaderView-copyButton"
          attributes={{ "aria-label": this.props.copySelectionLabel }}
          onClick={this.copySelection}
          onMouseDown={theBuckStopsHere}
        />
        <Tooltip
          manager={this.props.tooltips}
          target={this.refCopyButton}
          title={this.state.copied ? "Copied" : this.props.copySelectionLabel}
          trigger={this.state.copied ? "manual" : "hover"}
        />
        {editable && this.props.stagingStatus === "unstaged" && (
          <Fragment>
            <button
              ref={this.refDiscardButton.setter}
              className="icon-trashcan git-panel-HunkHeaderView-discardButton"
              onClick={this.props.discardSelection}
              onMouseDown={theBuckStopsHere}
            />
            <Tooltip
              manager={this.props.tooltips}
              target={this.refDiscardButton}
              title={this.props.discardSelectionLabel}
            />
          </Fragment>
        )}
      </Fragment>
    );
  }

  copySelection = async () => {
    if (this.copyInProgress) return;
    this.copyInProgress = true;
    const hunk = this.props.hunk;
    clearTimeout(this.copyFeedbackTimeout);
    try {
      const copyResult = this.props.copySelection();
      if (this.state.copied) await this.updateState({ copied: false });
      const copied = await copyResult;
      if (!copied || this.destroyed || this.props.hunk !== hunk) return;
      await this.updateState({ copied: true });
      if (this.destroyed) return;
      this.copyFeedbackTimeout = setTimeout(() => this.updateState({ copied: false }), 1500);
    } finally {
      this.copyInProgress = false;
    }
  };

  didUpdate(previous) {
    if (previous.hunk !== this.props.hunk && this.state.copied) {
      clearTimeout(this.copyFeedbackTimeout);
      this.updateState({ copied: false });
    }
  }

  willDestroy() {
    clearTimeout(this.copyFeedbackTimeout);
  }

  didMouseDown(event) {
    return this.props.mouseDown(event, this.props.hunk);
  }
}
