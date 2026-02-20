/** @babel */
/** @jsx React.createElement */
import React from "react";
import cx from "classnames";

export default class BranchView extends React.Component {
  static defaultProps = {
    refRoot: () => {},
  };

  render() {
    const classNames = cx("git-panel-branch", "inline-block", {
      "git-panel-branch-detached": this.props.currentBranch.isDetached(),
    });

    return (
      <div className={classNames} ref={this.props.refRoot}>
        <span className="icon icon-git-branch" />
        <span className="branch-label">{this.props.currentBranch.getName()}</span>
      </div>
    );
  }
}
