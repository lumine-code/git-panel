/** @babel */
import { Disposable } from "lumine";
import View, { h } from "../etch/view";
import { holder } from "../etch/ownership";
import { extractProps } from "../helpers";

export default class Gutter extends View {
  static defaultProps = { visible: true, type: "decorated", labelFn() {} };
  constructor(props, children) {
    super(props, children);
    this.subscription = new Disposable();
    this.gutter = null;
    this.initialize();
  }
  render() {
    return h("span", { hidden: true });
  }
  didMount() {
    this.observeEditor();
  }
  didUpdate(previous) {
    if (
      [
        "editor",
        "name",
        "priority",
        "visible",
        "type",
        "labelFn",
        "onMouseDown",
        "onMouseMove",
        "className",
      ].some((key) => previous[key] !== this.props[key])
    )
      this.observeEditor();
  }
  observeEditor() {
    this.subscription.dispose();
    this.clearGutter();
    this.subscription = holder(this.props.editor).observe((editor) => {
      if (this.destroyed || editor.isDestroyed()) return;
      this.clearGutter();
      this.gutter = editor.addGutter({
        ...extractProps(this.props, {
          name: true,
          priority: true,
          visible: true,
          type: true,
          labelFn: true,
          onMouseDown: true,
          onMouseMove: true,
        }),
        class: this.props.className,
      });
    });
  }
  clearGutter() {
    if (this.gutter && !this.gutter.destroyed) this.gutter.destroy();
    this.gutter = null;
  }
  willDestroy() {
    this.subscription.dispose();
    this.clearGutter();
  }
}
