/** @babel */
/** @jsx React.createElement */
import React from "react";
import { CompositeDisposable } from "atom";
import { TextBuffer } from "atom";
import path from "path";

import TabGroup from "../tab-group";
import DialogView from "./dialog-view";
import { TabbableTextEditor } from "./tabbable";
import { getRepositoryName } from "../clone-url";

export default class CloneDialog extends React.Component {
  constructor(props) {
    super(props);

    const params = this.props.request.getParams();
    this.sourceURL = new TextBuffer({ text: params.sourceURL });
    this.destinationPath = new TextBuffer({
      text: params.destPath || this.props.config.get("core.projectHome"),
    });
    this.remoteName = new TextBuffer({ text: "origin" });
    this.destinationPathModified = false;

    this.state = {
      acceptEnabled: false,
    };

    this.subs = new CompositeDisposable(
      this.sourceURL.onDidChange(this.didChangeSourceUrl),
      this.destinationPath.onDidChange(this.didChangeDestinationPath),
    );

    this.tabGroup = new TabGroup();
  }

  render() {
    return (
      <DialogView
        progressMessage="cloning..."
        acceptEnabled={this.state.acceptEnabled}
        acceptClassNames="icon icon-repo-clone"
        acceptText="Clone"
        accept={this.accept}
        cancel={this.props.request.cancel}
        tabGroup={this.tabGroup}
        inProgress={this.props.inProgress}
        error={this.props.error}
        workspace={this.props.workspace}
        commands={this.props.commands}
      >
        <label className="git-panel-DialogLabel">
          Clone from
          <TabbableTextEditor
            tabGroup={this.tabGroup}
            commands={this.props.commands}
            autofocus
            className="git-panel-Clone-sourceURL"
            mini
            readOnly={this.props.inProgress}
            buffer={this.sourceURL}
          />
        </label>
        <label className="git-panel-DialogLabel">
          To directory
          <TabbableTextEditor
            tabGroup={this.tabGroup}
            commands={this.props.commands}
            className="git-panel-Clone-destinationPath"
            mini
            readOnly={this.props.inProgress}
            buffer={this.destinationPath}
          />
        </label>
        <label className="git-panel-DialogLabel">
          Remote name
          <TabbableTextEditor
            tabGroup={this.tabGroup}
            commands={this.props.commands}
            className="git-panel-Clone-remoteName"
            mini
            readOnly={this.props.inProgress}
            buffer={this.remoteName}
          />
        </label>
      </DialogView>
    );
  }

  componentDidMount() {
    this.tabGroup.autofocus();
  }

  accept = () => {
    const sourceURL = this.sourceURL.getText();
    const destinationPath = this.destinationPath.getText();
    if (sourceURL === "" || destinationPath === "") {
      return Promise.resolve();
    }

    const remoteName = this.remoteName.getText() || "origin";
    return this.props.request.accept(sourceURL, destinationPath, remoteName);
  };

  didChangeSourceUrl = () => {
    if (!this.destinationPathModified) {
      const name = getRepositoryName(this.sourceURL.getText());

      if (name.length > 0) {
        const proposedPath = path.join(this.props.config.get("core.projectHome"), name);
        this.destinationPath.setText(proposedPath);
        this.destinationPathModified = false;
      }
    }

    this.setAcceptEnablement();
  };

  didChangeDestinationPath = () => {
    this.destinationPathModified = true;
    this.setAcceptEnablement();
  };

  setAcceptEnablement = () => {
    const enabled = !this.sourceURL.isEmpty() && !this.destinationPath.isEmpty();
    if (enabled !== this.state.acceptEnabled) {
      this.setState({ acceptEnabled: enabled });
    }
  };
}
