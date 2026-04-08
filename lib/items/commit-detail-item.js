/** @babel */
/** @jsx React.createElement */
import React from "react";
import { Emitter } from "atom";

import CommitDetailContainer from "../containers/commit-detail-container";
import RefHolder from "../models/ref-holder";

export default class CommitDetailItem extends React.Component {
  static uriPattern = "atom-github://commit-detail?workdir={workingDirectory}&sha={sha}";

  static buildURI(workingDirectory, sha) {
    return `atom-github://commit-detail?workdir=${encodeURIComponent(workingDirectory)}&sha=${encodeURIComponent(sha)}`;
  }

  constructor(props) {
    super(props);

    this.emitter = new Emitter();
    this.isDestroyed = false;
    this.hasTerminatedPendingState = false;
    this.shouldFocus = true;
    this.refInitialFocus = new RefHolder();

    this.refEditor = new RefHolder();
    this.refEditor.observe((editor) => {
      if (editor.isAlive()) {
        this.emitter.emit("did-change-embedded-text-editor", editor);
        const disposable = atom.textEditors.add(editor);
        editor.onDidDestroy(() => disposable.dispose());
      }
    });
  }

  terminatePendingState() {
    if (!this.hasTerminatedPendingState) {
      this.emitter.emit("did-terminate-pending-state");
      this.hasTerminatedPendingState = true;
    }
  }

  onDidTerminatePendingState(callback) {
    return this.emitter.on("did-terminate-pending-state", callback);
  }

  destroy = () => {
    /* istanbul ignore else */
    if (!this.isDestroyed) {
      this.emitter.emit("did-destroy");
      this.isDestroyed = true;
    }
  };

  onDidDestroy(callback) {
    return this.emitter.on("did-destroy", callback);
  }

  render() {
    const repository = this.props.workdirContextPool
      .getContext(this.props.workingDirectory)
      .getRepository();

    return (
      <CommitDetailContainer
        itemType={this.constructor}
        repository={repository}
        {...this.props}
        destroy={this.destroy}
        refEditor={this.refEditor}
        refInitialFocus={this.refInitialFocus}
      />
    );
  }

  getTitle() {
    return `Commit: ${this.props.sha}`;
  }

  getIconName() {
    return "git-commit";
  }

  observeEmbeddedTextEditor(cb) {
    this.refEditor.map((editor) => editor.isAlive() && cb(editor));
    return this.emitter.on("did-change-embedded-text-editor", cb);
  }

  getWorkingDirectory() {
    return this.props.workingDirectory;
  }

  getSha() {
    return this.props.sha;
  }

  serialize() {
    return {
      deserializer: "CommitDetailStub",
      uri: CommitDetailItem.buildURI(this.props.workingDirectory, this.props.sha),
    };
  }

  preventFocus() {
    this.shouldFocus = false;
  }

  focus() {
    this.refInitialFocus.getPromise().then((focusable) => {
      if (!this.shouldFocus) {
        return;
      }

      focusable.focus();
    });
  }
}
