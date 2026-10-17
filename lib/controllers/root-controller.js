/** @babel */
/** @jsx h */
import { View, h, Fragment } from "../etch/view.js";

import GitTabItem from "../items/git-tab-item.js";
import TabTracker from "./tab-tracker.js";
import GitRootController from "./git-root-controller.js";
import Switchboard from "../switchboard.js";

export default class RootController extends View {
  static defaultProps = {
    switchboard: new Switchboard(),
    startOpenGitTab: false,
  };

  constructor(props, children) {
    super(props, children);

    this.gitTabTracker = new TabTracker("git", {
      uri: GitTabItem.buildURI(),
      getWorkspace: () => this.props.workspace,
    });

    this.initialize();
  }

  didMount() {
    this.openTabs();
  }

  render() {
    return h(
      "span",
      { style: { display: "contents" } },
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
          workdirContextPool={this.props.workdirContextPool}
          repository={this.props.repository}
          startupContextPending={this.props.startupContextPending}
          resolutionProgress={this.props.resolutionProgress}
          busySignal={this.props.busySignal}
          initialize={this.props.initialize}
          clone={this.props.clone}
          currentWorkDir={this.props.currentWorkDir}
          gitTabTracker={this.gitTabTracker}
          createGitPaneItem={this.props.createGitPaneItem}
          createPatchPaneItem={this.props.createPatchPaneItem}
          selectRepository={this.props.selectRepository}
          createGitTimingsPaneItem={this.props.createGitTimingsPaneItem}
          createGitCachePaneItem={this.props.createGitCachePaneItem}
        />
      </Fragment>,
    );
  }

  async openTabs() {
    if (this.props.startOpenGitTab) {
      await this.gitTabTracker.ensureRendered(false);
    }
  }
}
