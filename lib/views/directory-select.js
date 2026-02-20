/** @babel */
/** @jsx React.createElement */
import React from "react";
import { remote } from "electron";

import { TabbableTextEditor, TabbableButton } from "./tabbable";

const { dialog } = remote;

export default class DirectorySelect extends React.Component {
  static defaultProps = {
    disabled: false,
    showOpenDialog: /* istanbul ignore next */ (...args) => dialog.showOpenDialog(...args),
  };

  render() {
    return (
      <div className="git-panel-Dialog-row">
        <TabbableTextEditor
          tabGroup={this.props.tabGroup}
          commands={this.props.commands}
          className="git-panel-DirectorySelect-destinationPath"
          mini={true}
          readOnly={this.props.disabled}
          buffer={this.props.buffer}
        />
        <TabbableButton
          tabGroup={this.props.tabGroup}
          commands={this.props.commands}
          className="btn icon icon-file-directory git-panel-Dialog-rightBumper"
          disabled={this.props.disabled}
          onClick={this.chooseDirectory}
        />
      </div>
    );
  }

  chooseDirectory = async () => {
    const { filePaths } = await this.props.showOpenDialog(this.props.currentWindow, {
      defaultPath: this.props.buffer.getText(),
      properties: ["openDirectory", "createDirectory", "promptToCreate"],
    });
    if (filePaths.length) {
      this.props.buffer.setText(filePaths[0]);
    }
  };
}
