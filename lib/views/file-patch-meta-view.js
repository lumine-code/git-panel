/** @babel */
/** @jsx React.createElement */
import React from "react";
import cx from "classnames";

import CommitDetailItem from "../items/commit-detail-item";

export default class FilePatchMetaView extends React.Component {
  renderMetaControls() {
    if (this.props.itemType === CommitDetailItem) {
      return null;
    }
    return (
      <div className="git-panel-FilePatchView-metaControls">
        <button
          className={cx("git-panel-FilePatchView-metaButton", "icon", this.props.actionIcon)}
          onClick={this.props.action}
        >
          {this.props.actionText}
        </button>
      </div>
    );
  }

  render() {
    return (
      <div className="git-panel-FilePatchView-meta">
        <div className="git-panel-FilePatchView-metaContainer">
          <header className="git-panel-FilePatchView-metaHeader">
            <h3 className="git-panel-FilePatchView-metaTitle">{this.props.title}</h3>
            {this.renderMetaControls()}
          </header>
          <div className="git-panel-FilePatchView-metaDetails">{this.props.children}</div>
        </div>
      </div>
    );
  }
}
