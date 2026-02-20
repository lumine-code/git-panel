/** @babel */
/** @jsx React.createElement */
import React, { Fragment } from "react";
import cx from "classnames";

import { autobind } from "../helpers";
import RefHolder from "../models/ref-holder";
import Tooltip from "../atom/tooltip";
import Keystroke from "../atom/keystroke";
import CommitDetailItem from "../items/commit-detail-item";

function theBuckStopsHere(event) {
  event.stopPropagation();
}

export default class HunkHeaderView extends React.Component {
  constructor(props) {
    super(props);
    autobind(this, "didMouseDown", "renderButtons");

    this.refDiscardButton = new RefHolder();
  }

  render() {
    const conditional = {
      "git-panel-HunkHeaderView--isSelected": this.props.isSelected,
      "git-panel-HunkHeaderView--isHunkMode": this.props.selectionMode === "hunk",
    };

    return (
      <div className={cx("git-panel-HunkHeaderView", conditional)} onMouseDown={this.didMouseDown}>
        <span className="git-panel-HunkHeaderView-title">
          {this.props.hunk.getHeader().trim()} {this.props.hunk.getSectionHeading().trim()}
        </span>
        {this.renderButtons()}
      </div>
    );
  }

  renderButtons() {
    if (this.props.itemType === CommitDetailItem) {
      return null;
    } else {
      return (
        <Fragment>
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
          {this.props.stagingStatus === "unstaged" && (
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
  }

  didMouseDown(event) {
    return this.props.mouseDown(event, this.props.hunk);
  }
}
