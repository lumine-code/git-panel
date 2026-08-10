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

    this.domNode = document.createElement("div");
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

    // The bar stamps `.status-bar-item` on whatever it hosts, and a theme draws
    // one tile's padding, hover and pill from that mark. With `hostsTiles` this
    // host holds several independent controls, so the mark belongs on each of
    // them and not on the box that groups them — left here, a theme paints one
    // rectangle across the lot and they read as a single joined item. Hand it
    // down: the children carry the class themselves.
    if (this.props.hostsTiles) {
      this.domNode.classList.remove("status-bar-item");
    }

    this.props.onConsumeStatusBar(this.props.statusBar);
  }

  componentWillUnmount() {
    this.tile && this.tile.destroy();
  }
}
