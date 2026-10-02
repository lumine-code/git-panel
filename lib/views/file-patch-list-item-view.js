/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";
import { CompositeDisposable } from "lumine";

import { classNameForStatus } from "../helpers";
import RefHolder from "../models/ref-holder";

export default class FilePatchListItemView extends View {
  static defaultProps = {
    registerItemElement: () => {},
  };

  constructor(props, children) {
    super(props, children);

    this.refItem = new RefHolder();
    this.subs = new CompositeDisposable(
      this.refItem.observe((item) => this.props.registerItemElement(this.props.filePatch, item)),
    );

    this.initialize();
  }

  update(props, children) {
    // Etch derives a fresh `on` map from the stable event props for each vnode.
    const keys = new Set([...Object.keys(props), ...Object.keys(this.props)]);
    keys.delete("on");
    keys.delete("children");
    keys.delete("key");
    keys.delete("ref");
    if (Array.from(keys).every((key) => props[key] === this.props[key])) return Promise.resolve();
    return super.update(props, children);
  }

  didUpdate() {
    this.refItem.map((item) => this.props.registerItemElement(this.props.filePatch, item));
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

  willDestroy() {
    this.subs.dispose();
  }
}
