/** @babel */
/** @jsx h */
import View, { h } from "../etch/view";
import { Disposable } from "lumine";
import { autobind } from "../helpers";
import { humanizeKeystroke } from "./humankeys";

export default class Keystroke extends View {
  constructor(props, children) {
    super(props, children);
    autobind(this, "didChangeTarget");

    this.sub = new Disposable();
    this.state = { keybinding: null };
    this.initialize();
  }

  didMount() {
    this.observeTarget();
  }

  didUpdate(prevProps, prevState) {
    if (this.props.refTarget !== prevProps.refTarget) {
      this.observeTarget();
    } else if (this.props.command !== prevProps.command) {
      this.didChangeTarget(this.props.refTarget.getOr(null));
    }
  }

  willDestroy() {
    this.sub.dispose();
  }

  render() {
    if (!this.state.keybinding) {
      return h("span", { hidden: true });
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
    this.updateState({ keybinding });
  }
}
