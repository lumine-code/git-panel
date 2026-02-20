/** @babel */
/** @jsx React.createElement */
import React from "react";
import { Emitter } from "atom";

import { autobind } from "../helpers";
import ChangedFileContainer from "../containers/changed-file-container";
import RefHolder from "../models/ref-holder";

export default class ChangedFileItem extends React.Component {
  static uriPattern =
    "atom-github://file-patch/{relPath...}?workdir={workingDirectory}&stagingStatus={stagingStatus}";

  static buildURI(relPath, workingDirectory, stagingStatus) {
    return (
      "atom-github://file-patch/" +
      encodeURIComponent(relPath) +
      `?workdir=${encodeURIComponent(workingDirectory)}` +
      `&stagingStatus=${encodeURIComponent(stagingStatus)}`
    );
  }

  constructor(props) {
    super(props);
    autobind(this, "destroy");

    this.emitter = new Emitter();
    this.isDestroyed = false;
    this.hasTerminatedPendingState = false;

    this.refEditor = new RefHolder();
    this.refEditor.observe((editor) => {
      if (editor.isAlive()) {
        this.emitter.emit("did-change-embedded-text-editor", editor);
      }
    });
  }

  getTitle() {
    let title = this.props.stagingStatus === "staged" ? "Staged" : "Unstaged";
    title += " Changes: ";
    title += this.props.relPath;
    return title;
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

  destroy() {
    /* istanbul ignore else */
    if (!this.isDestroyed) {
      this.emitter.emit("did-destroy");
      this.isDestroyed = true;
    }
  }

  onDidDestroy(callback) {
    return this.emitter.on("did-destroy", callback);
  }

  render() {
    const repository = this.props.workdirContextPool
      .getContext(this.props.workingDirectory)
      .getRepository();

    return (
      <ChangedFileContainer
        itemType={this.constructor}
        repository={repository}
        destroy={this.destroy}
        refEditor={this.refEditor}
        {...this.props}
      />
    );
  }

  observeEmbeddedTextEditor(cb) {
    this.refEditor.map((editor) => editor.isAlive() && cb(editor));
    return this.emitter.on("did-change-embedded-text-editor", cb);
  }

  serialize() {
    return {
      deserializer: "FilePatchControllerStub",
      uri: ChangedFileItem.buildURI(
        this.props.relPath,
        this.props.workingDirectory,
        this.props.stagingStatus,
      ),
    };
  }

  getStagingStatus() {
    return this.props.stagingStatus;
  }

  getFilePath() {
    return this.props.relPath;
  }

  getWorkingDirectory() {
    return this.props.workingDirectory;
  }

  isFilePatchItem() {
    return true;
  }
}
