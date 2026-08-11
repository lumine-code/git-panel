/** @babel */
import React from "react";
import ReactDOM from "react-dom";

export default class StatusBar extends React.Component {
  static defaultProps = {
    onConsumeStatusBar: (statusBar) => {},
    hostsTiles: false,
  };

  constructor(props) {
    super(props);

    // `hostsTiles` means this box carries several independent controls rather
    // than being one itself, which is exactly what a tile group is: the bar
    // marks the `<status-bar-tile>` children and leaves the group unmarked, so
    // each control gets its own hover rectangle instead of one across the lot.
    this.domNode = document.createElement(
      props.hostsTiles ? "status-bar-tile-group" : "status-bar-tile",
    );
    this.domNode.classList.add("react-lumine-status-bar");
    if (props.className) {
      this.domNode.classList.add(props.className);
    }
    this.tile = null;
  }

  componentDidMount() {
    this.consumeStatusBar();
  }

  componentDidUpdate(prevProps) {
    if (!prevProps.statusBar && this.props.statusBar) {
      this.consumeStatusBar();
    }
  }

  render() {
    return ReactDOM.createPortal(this.props.children, this.domNode);
  }

  consumeStatusBar() {
    if (this.tile) {
      return;
    }
    if (!this.props.statusBar) {
      return;
    }

    // Source-control band, see the priority convention in the status-bar
    // package README.
    this.tile = this.props.statusBar.addRightTile({ item: this.domNode, priority: 310 });
    this.props.onConsumeStatusBar(this.props.statusBar);
  }

  componentWillUnmount() {
    this.tile && this.tile.destroy();
  }
}
