/** @babel */
import React from "react";
import ReactDOM from "react-dom";
import { CompositeDisposable } from "atom";

import { createItem } from "../helpers";

/**
 * `Panel` renders a React component into an Atom panel. Specify the location via the `location` prop, and any
 * additional options to the `addXPanel` method in the `options` prop.
 *
 * You can get the underlying Atom panel via `getPanel()`, but you should consider controlling the panel via React and
 * the Panel component instead.
 */
export default class Panel extends React.Component {
  static defaultProps = {
    options: {},
    onDidClosePanel: (panel) => {},
  };

  constructor(props) {
    super(props);

    this.subscriptions = new CompositeDisposable();
    this.panel = null;
    this.didCloseItem = false;
    this.domNode = document.createElement("div");
    this.domNode.className = "react-atom-panel";
  }

  componentDidMount() {
    this.setupPanel();
  }

  render() {
    return ReactDOM.createPortal(this.props.children, this.domNode);
  }

  setupPanel() {
    if (this.panel) {
      return;
    }

    // "left" => "Left"
    const location = this.props.location.substr(0, 1).toUpperCase() + this.props.location.substr(1);
    const methodName = `add${location}Panel`;

    const item = createItem(this.domNode, this.props.itemHolder);
    const options = { ...this.props.options, item };
    this.panel = this.props.workspace[methodName](options);
    this.subscriptions.add(
      this.panel.onDidDestroy(() => {
        this.didCloseItem = true;
        this.props.onDidClosePanel(this.panel);
      }),
    );
  }

  componentWillUnmount() {
    this.subscriptions.dispose();
    if (this.panel) {
      this.panel.destroy();
    }
  }

  getPanel() {
    return this.panel;
  }
}
