/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";
import { TextBuffer } from "lumine";

import TabGroup from "../tab-group";
import { TabbableTextEditor } from "./tabbable";
import DialogView from "./dialog-view";

export default class InitDialog extends View {
  constructor(props, children) {
    super(props, children);

    this.tabGroup = new TabGroup();

    this.destinationPath = new TextBuffer({
      text: this.props.request.getParams().dirPath,
    });

    this.sub = this.destinationPath.onDidChange(this.setAcceptEnablement);

    this.state = {
      acceptEnabled: !this.destinationPath.isEmpty(),
    };

    this.initialize();
  }

  render() {
    return h(
      "span",
      { style: { display: "contents" } },
      <DialogView
        progressMessage="Initializing..."
        acceptEnabled={this.state.acceptEnabled}
        acceptClassName="icon icon-repo-create"
        acceptText="Init"
        accept={this.accept}
        cancel={this.props.request.cancel}
        tabGroup={this.tabGroup}
        inProgress={this.props.inProgress}
        error={this.props.error}
        workspace={this.props.workspace}
        commands={this.props.commands}
      >
        <label className="git-panel-DialogLabel">
          Initialize git repository in directory
          <TabbableTextEditor
            tabGroup={this.tabGroup}
            commands={this.props.commands}
            autofocus
            mini
            preselect
            readOnly={this.props.inProgress}
            buffer={this.destinationPath}
          />
        </label>
      </DialogView>,
    );
  }

  didMount() {
    this.tabGroup.autofocus();
  }

  willDestroy() {
    this.sub.dispose();
  }

  accept = () => {
    const destPath = this.destinationPath.getText();
    if (destPath.length === 0) {
      return Promise.resolve();
    }

    return this.props.request.accept(destPath);
  };

  setAcceptEnablement = () => {
    const enablement = !this.destinationPath.isEmpty();
    if (enablement !== this.state.acceptEnabled) {
      this.updateState({ acceptEnabled: enablement });
    }
  };
}
