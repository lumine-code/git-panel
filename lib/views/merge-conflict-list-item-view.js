/** @babel */
/** @jsx React.createElement */
import React from "react";
import { CompositeDisposable } from "atom";

import { classNameForStatus } from "../helpers";
import RefHolder from "../models/ref-holder";

export default class MergeConflictListItemView extends React.Component {
  constructor(props) {
    super(props);

    this.refItem = new RefHolder();
    this.subs = new CompositeDisposable(
      this.refItem.observe((item) =>
        this.props.registerItemElement(this.props.mergeConflict, item),
      ),
    );
  }

  render() {
    const { mergeConflict, selected, ...others } = this.props;
    delete others.remainingConflicts;
    delete others.registerItemElement;
    const fileStatus = classNameForStatus[mergeConflict.status.file];
    const oursStatus = classNameForStatus[mergeConflict.status.ours];
    const theirsStatus = classNameForStatus[mergeConflict.status.theirs];
    const className = selected ? "is-selected" : "";

    return (
      <div
        ref={this.refItem.setter}
        {...others}
        className={`git-panel-MergeConflictListView-item is-${fileStatus} ${className}`}
      >
        <div className="git-panel-FilePatchListView-item git-panel-FilePatchListView-pathItem">
          <span
            className={`git-panel-FilePatchListView-icon icon icon-diff-${fileStatus} status-${fileStatus}`}
          />
          <span className="git-panel-FilePatchListView-path">{mergeConflict.filePath}</span>
          <span className={"git-panel-FilePatchListView ours-theirs-info"}>
            <span className={`git-panel-FilePatchListView-icon icon icon-diff-${oursStatus}`} />
            <span className={`git-panel-FilePatchListView-icon icon icon-diff-${theirsStatus}`} />
          </span>
        </div>
        <div className="git-panel-FilePatchListView-item git-panel-FilePatchListView-resolutionItem">
          {this.renderRemainingConflicts()}
        </div>
      </div>
    );
  }

  renderRemainingConflicts() {
    if (this.props.remainingConflicts === 0) {
      return (
        <span className="icon icon-check git-panel-RemainingConflicts text-success">ready</span>
      );
    } else if (this.props.remainingConflicts !== undefined) {
      const pluralConflicts = this.props.remainingConflicts === 1 ? "" : "s";

      return (
        <span className="git-panel-RemainingConflicts text-warning">
          {this.props.remainingConflicts} conflict{pluralConflicts} remaining
        </span>
      );
    } else {
      return <span className="git-panel-RemainingConflicts text-subtle">calculating</span>;
    }
  }

  componentWillUnmount() {
    this.subs.dispose();
  }
}
