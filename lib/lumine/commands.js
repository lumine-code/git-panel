/** @babel */
import { Disposable } from "lumine";
import View, { h } from "../etch/view";
import { bindChildren, holder } from "../etch/ownership";

export default class Commands extends View {
  constructor(props, children) {
    super(props, children);
    this.initialize();
  }

  render() {
    return h(
      "span",
      { hidden: true },
      bindChildren(this.props.children, {
        registry: this.props.registry,
        target: this.props.target,
      }),
    );
  }
}

export class Command extends View {
  constructor(props, children) {
    super(props, children);
    this.subTarget = new Disposable();
    this.subCommand = new Disposable();
    this.initialize();
  }

  render() {
    return h("span", { hidden: true });
  }
  didMount() {
    this.observeTarget();
  }

  didUpdate(previous) {
    if (
      ["registry", "target", "command", "callback", "description"].some(
        (key) => previous[key] !== this.props[key],
      )
    )
      this.observeTarget();
  }

  observeTarget() {
    this.subTarget.dispose();
    this.subCommand.dispose();
    this.subTarget = holder(this.props.target).observe((target) => {
      if (this.destroyed) return;
      this.subCommand.dispose();
      const { registry, command, callback, description } = this.props;
      this.subCommand = registry.add(
        target,
        command,
        description ? { description, didDispatch: callback } : callback,
      );
    });
  }

  willDestroy() {
    this.subTarget.dispose();
    this.subCommand.dispose();
  }
}
