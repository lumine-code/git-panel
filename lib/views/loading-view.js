/** @babel */
/** @jsx React.createElement */
import React from "react";

export default class LoadingView extends React.Component {
  render() {
    return (
      <div className="git-panel-Loader">
        <span className="git-panel-Spinner" />
      </div>
    );
  }
}
