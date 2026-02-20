/** @babel */
import React from "react";
import ReactDOM from "react-dom";

export default class StatusBar extends React.Component {
  static defaultProps = {
    onConsumeStatusBar: (statusBar) => {},
  };

  constructor(props) {
    super(props);

    this.domNode = document.createElement("div");
    this.domNode.classList.add("react-atom-status-bar");
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

    this.tile = this.props.statusBar.addRightTile({ item: this.domNode, priority: -50 });
    this.props.onConsumeStatusBar(this.props.statusBar);
  }

  componentWillUnmount() {
    this.tile && this.tile.destroy();
  }
}
