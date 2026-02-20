/** @babel */
/** @jsx React.createElement */
import React from "react";
import { Disposable } from "atom";

import { autobind } from "../helpers";

const MODIFIERS =
  process.platform === "darwin"
    ? { cmd: "\u2318", ctrl: "\u2303", alt: "\u2325", shift: "\u21E7" }
    : { cmd: "", ctrl: "Ctrl", alt: "Alt", shift: "Shift" };

function humanizeKeystroke(keystroke) {
  return keystroke
    .split(" ")
    .map((keys) =>
      keys
        .split("-")
        .map((key) => MODIFIERS[key] || key.toUpperCase())
        .join(process.platform === "darwin" ? "" : "+"),
    )
    .join(" ");
}

export default class Keystroke extends React.Component {
  constructor(props) {
    super(props);
    autobind(this, "didChangeTarget");

    this.sub = new Disposable();
    this.state = { keybinding: null };
  }

  componentDidMount() {
    this.observeTarget();
  }

  componentDidUpdate(prevProps, prevState) {
    if (this.props.refTarget !== prevProps.refTarget) {
      this.observeTarget();
    } else if (this.props.command !== prevProps.command) {
      this.didChangeTarget(this.props.refTarget.getOr(null));
    }
  }

  componentWillUnmount() {
    this.sub.dispose();
  }

  render() {
    if (!this.state.keybinding) {
      return null;
    }

    return <span className="keystroke">{humanizeKeystroke(this.state.keybinding.keystrokes)}</span>;
  }

  observeTarget() {
    this.sub.dispose();
    if (this.props.refTarget) {
      this.sub = this.props.refTarget.observe(this.didChangeTarget);
    } else {
      this.didChangeTarget(null);
    }
  }

  didChangeTarget(target) {
    const [keybinding] = this.props.keymaps.findKeyBindings({
      command: this.props.command,
      target,
    });
    this.setState({ keybinding });
  }
}
