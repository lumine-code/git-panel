/** @babel */
/** @jsx React.createElement */
import React from "react";
import Octicon from "../atom/octicon";

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
  }

  handleClick() {
    this.props.didClick();
  }

  render() {
    return (
      <button className="git-panel-ChangedFilesCount inline-block" onClick={this.handleClick}>
        <Octicon icon="git-commit" />
        {`Git (${this.props.changedFilesCount})`}
        {this.props.mergeConflictsPresent && <Octicon icon="alert" />}
      </button>
    );
  }
}
