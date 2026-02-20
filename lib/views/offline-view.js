/** @babel */
/** @jsx React.createElement */
import React from "react";

import Octicon from "../atom/octicon";

export default class OfflineView extends React.Component {
  componentDidMount() {
    window.addEventListener("online", this.props.retry);
  }

  componentWillUnmount() {
    window.removeEventListener("online", this.props.retry);
  }

  render() {
    return (
      <div className="git-panel-Offline git-panel-Message">
        <div className="git-panel-Message-wrapper">
          <Octicon className="git-panel-Offline-logo" icon="alignment-unalign" />
          <h1 className="git-panel-Message-title">Offline</h1>
          <p className="git-panel-Message-description">
            You don't seem to be connected to the Internet. When you're back online, we'll try
            again.
          </p>
          <p className="git-panel-Message-action">
            <button className="git-panel-Message-button btn" onClick={this.props.retry}>
              Retry
            </button>
          </p>
        </div>
      </div>
    );
  }
}
