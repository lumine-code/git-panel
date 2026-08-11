/** @babel */
/** @jsx React.createElement */
import React from "react";
import Octicon from "../lumine/octicon";
import Tooltip from "../lumine/tooltip";
import RefHolder from "../models/ref-holder";

import { autobind } from "../helpers";

export default class ChangedFilesCountView extends React.Component {
  static defaultProps = {
    changedFilesCount: 0,
    mergeConflictsPresent: false,
    didClick: () => {},
  };

  constructor(props) {
    super(props);
    autobind(this, "handleClick");
    this.refTileNode = new RefHolder();
    this.tooltipEntries = [
      { title: "Toggle Git panel", keyBindingExtra: "LMB" },
      {
        title: "Toggle focus",
        keyBindingCommand: "git-panel:toggle-focus",
        keyBindingTarget: props.keyBindingTarget,
      },
    ];
  }

  handleClick() {
    this.props.didClick();
  }

  render() {
    return (
      <status-bar-tile
        ref={this.refTileNode.setter}
        className="git-panel-ChangedFilesCount"
        onClick={this.handleClick}
      >
        <Octicon icon="git-commit" />
        {`Git (${this.props.changedFilesCount})`}
        {this.props.mergeConflictsPresent && <Octicon icon="alert" />}
        {this.props.tooltipManager && (
          <Tooltip
            manager={this.props.tooltipManager}
            target={this.refTileNode}
            entries={this.tooltipEntries}
          />
        )}
      </status-bar-tile>
    );
  }
}
