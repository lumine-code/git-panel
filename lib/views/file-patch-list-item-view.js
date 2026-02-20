/** @babel */
/** @jsx React.createElement */
import React from "react";
import { CompositeDisposable } from "atom";

import { classNameForStatus } from "../helpers";
import RefHolder from "../models/ref-holder";

export default class FilePatchListItemView extends React.Component {
  static defaultProps = {
    registerItemElement: () => {},
  };

  constructor(props) {
    super(props);

    this.refItem = new RefHolder();
    this.subs = new CompositeDisposable(
      this.refItem.observe((item) => this.props.registerItemElement(this.props.filePatch, item)),
    );
  }

  render() {
    const { filePatch, selected, ...others } = this.props;
    delete others.registerItemElement;
    const status = classNameForStatus[filePatch.status];
    const className = selected ? "is-selected" : "";

    return (
      <div
        ref={this.refItem.setter}
        {...others}
        className={`git-panel-FilePatchListView-item is-${status} ${className}`}
      >
        <span
          className={`git-panel-FilePatchListView-icon icon icon-diff-${status} status-${status}`}
        />
        <span className="git-panel-FilePatchListView-path">{filePatch.filePath}</span>
      </div>
    );
  }

  componentWillUnmount() {
    this.subs.dispose();
  }
}
