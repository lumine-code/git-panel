/** @babel */
/** @jsx h */
import { View, h } from "../etch/view.js";
import { TextBuffer } from "lumine";

import PatchDocument from "../models/patch-document.js";
import { isGitError } from "../git-errors.js";
import DialogView from "./dialog-view.js";
import TabGroup from "../tab-group.js";
import { TabbableTextEditor } from "./tabbable.js";
import { scalarInputsFit, acceptScalarInputs } from "../scalar-input.js";

export default class OpenCommitDialog extends View {
  constructor(props, children) {
    super(props, children);

    this.ref = new TextBuffer();
    this.sub = this.ref.onDidChange(this.didChangeRef);

    this.state = {
      acceptEnabled: false,
    };

    this.tabGroup = new TabGroup();

    this.initialize();
  }

  render() {
    return h(
      "span",
      { style: { display: "contents" } },
      <DialogView
        prompt="Open Commit"
        acceptEnabled={this.state.acceptEnabled}
        acceptClassName="icon icon-commit"
        acceptText="Open commit"
        accept={this.accept}
        cancel={this.props.request.cancel}
        tabGroup={this.tabGroup}
        inProgress={this.props.inProgress}
        error={this.props.error}
        workspace={this.props.workspace}
        commands={this.props.commands}
      >
        <label className="git-panel-DialogLabel git-panel-CommitRef dialog-field">
          <span className="dialog-label">Commit SHA or ref</span>
          <TabbableTextEditor
            tabGroup={this.tabGroup}
            commands={this.props.commands}
            autofocus
            mini
            ariaLabel="Commit SHA or ref"
            readOnly={this.props.inProgress}
            buffer={this.ref}
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
    if (!acceptScalarInputs(this.ref)) return Promise.resolve();
    const ref = this.ref.getText();
    if (ref.length === 0) {
      return Promise.resolve();
    }

    return this.props.request.accept(ref);
  };

  didChangeRef = () => {
    const enabled = scalarInputsFit(this.ref) && !this.ref.isEmpty();
    if (this.state.acceptEnabled !== enabled) {
      this.updateState({ acceptEnabled: enabled });
    }
  };
}

export async function openCommitDetailItem(ref, { workspace, repository }) {
  try {
    const commit = await repository.getCommit(ref);
    if (!commit?.isPresent()) {
      const error = new Error(`No commit found for ${ref}`);
      error.userMessage = "There is no commit associated with that reference.";
      throw error;
    }
  } catch (error) {
    if (isGitError(error) && error.exitCode === 128) {
      error.userMessage = "There is no commit associated with that reference.";
    }

    throw error;
  }

  const item = await workspace.open(
    PatchDocument.commit(repository.getWorkingDirectoryPath(), ref).getURI(),
    {
      searchAllPanes: true,
      pending: true,
    },
  );
  return item;
}
