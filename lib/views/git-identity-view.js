/** @babel */
/** @jsx React.createElement */
import React from "react";
import AtomTextEditor from "../atom/atom-text-editor";

export default class GitIdentityView extends React.Component {
  render() {
    return (
      <div className="git-panel-GitIdentity">
        <h1 className="git-panel-GitIdentity-title">Git Identity</h1>
        <p className="git-panel-GitIdentity-explanation">
          Please set the username and email address that you wish to use to author git commits. This
          will write to the
          <code>user.name</code> and <code>user.email</code> values in your git configuration at the
          chosen scope.
        </p>
        <div className="git-panel-GitIdentity-text">
          <AtomTextEditor mini placeholderText="name" buffer={this.props.usernameBuffer} />
          <AtomTextEditor mini placeholderText="email address" buffer={this.props.emailBuffer} />
        </div>
        <div className="git-panel-GitIdentity-buttons">
          <button className="btn" onClick={this.props.close}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            title="Configure git for this repository"
            onClick={this.props.setLocal}
            disabled={!this.props.canWriteLocal}
          >
            Use for this repository
          </button>
          <button
            className="btn btn-primary"
            title="Configure git globally for your operating system user account"
            onClick={this.props.setGlobal}
          >
            Use for all repositories
          </button>
        </div>
      </div>
    );
  }
}
