/** @babel */
/** @jsx React.createElement */
import React from "react";

export default class ErrorView extends React.Component {
  static defaultProps = {
    title: "Error",
    descriptions: ["An unknown error occurred"],
    preformatted: false,
  };

  render() {
    return (
      <div className="git-panel-Message">
        <div className="git-panel-Message-wrapper">
          <h1 className="git-panel-Message-title">{this.props.title}</h1>
          {this.props.descriptions.map(this.renderDescription)}
          <div className="git-panel-Message-action">
            {this.props.retry && (
              <button
                className="git-panel-Message-button btn btn-primary"
                onClick={this.props.retry}
              >
                Try Again
              </button>
            )}
            {this.props.logout && (
              <button
                className="git-panel-Message-button btn btn-logout"
                onClick={this.props.logout}
              >
                Logout
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  renderDescription = (description, key) => {
    if (this.props.preformatted) {
      return (
        <pre key={key} className="git-panel-Message-description">
          {description}
        </pre>
      );
    } else {
      return (
        <p key={key} className="git-panel-Message-description">
          {description}
        </p>
      );
    }
  };
}
