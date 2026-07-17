/** @babel */
/** @jsx React.createElement */
import React, { Fragment } from "react";

import GitTabItem from "../items/git-tab-item";
import TabTracker from "./tab-tracker";
import GitRootController from "./git-root-controller";
import Switchboard from "../switchboard";

export default class RootController extends React.Component {
  static defaultProps = {
    switchboard: new Switchboard(),
    startOpenGitTab: false,
  };

  constructor(props, context) {
    super(props, context);

    this.gitTabTracker = new TabTracker("git", {
      uri: GitTabItem.buildURI(),
      getWorkspace: () => this.props.workspace,
    });
  }

  componentDidMount() {
    this.openTabs();
  }

  render() {
    return (
      <Fragment>
        <GitRootController
          ref={(c) => {
            this.gitController = c;
          }}
          workspace={this.props.workspace}
          commands={this.props.commands}
          notificationManager={this.props.notificationManager}
          tooltips={this.props.tooltips}
          grammars={this.props.grammars}
          keymaps={this.props.keymaps}
          config={this.props.config}
          project={this.props.project}
          repositories={this.props.repositories}
          confirm={this.props.confirm}
          currentWindow={this.props.currentWindow}
          workdirContextPool={this.props.workdirContextPool}
          repository={this.props.repository}
          resolutionProgress={this.props.resolutionProgress}
          statusBar={this.props.statusBar}
          initialize={this.props.initialize}
          clone={this.props.clone}
          currentWorkDir={this.props.currentWorkDir}
          gitTabTracker={this.gitTabTracker}
        />
      </Fragment>
    );
  }

  // Exposed for git-package.js which calls this.controller.openCredentialsDialog(query)
  openCredentialsDialog(query) {
    return this.gitController.openCredentialsDialog(query);
  }

  async openTabs() {
    if (this.props.startOpenGitTab) {
      await this.gitTabTracker.ensureRendered(false);
    }
  }
}
