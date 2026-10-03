/** @babel */
import { CompositeDisposable, Disposable } from "lumine";
import View, { h } from "../etch/view";
import { holder } from "../etch/ownership";
import { extractProps } from "../helpers";

export default class Gutter extends View {
  static defaultProps = { visible: true, type: "decorated", labelFn() {} };
  constructor(props, children) {
    super(props, children);
    this.subscription = new Disposable();
    this.gutterSubscriptions = new CompositeDisposable();
    this.visibilityGeneration = 0;
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
        "hideWhenEmpty",
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
        visible: this.props.visible && !this.props.hideWhenEmpty,
        class: this.props.className,
      });
      const gutter = this.gutter;
      const generation = this.visibilityGeneration;
      this.gutterSubscriptions.add(
        gutter.onDidDestroy(() => {
          if (this.gutter !== gutter) return;
          this.gutter = null;
          this.visibilityGeneration++;
          this.pendingVisibilityCheck = null;
          this.gutterSubscriptions.dispose();
        }),
      );
      if (this.props.hideWhenEmpty) {
        const schedule = () => this.scheduleVisibilityCheck(editor, gutter, generation);
        this.gutterSubscriptions.add(editor.onDidUpdateDecorations(schedule));
        schedule();
      }
    });
  }
  scheduleVisibilityCheck(editor, gutter, generation) {
    if (this.pendingVisibilityCheck?.generation === generation) return;
    const pending = { generation };
    this.pendingVisibilityCheck = pending;
    // A mounted diff creates many decorations in one commit. Scan the global
    // inventory once after that batch, rather than once per added marker.
    queueMicrotask(() => {
      if (this.pendingVisibilityCheck !== pending) return;
      this.pendingVisibilityCheck = null;
      if (
        this.destroyed ||
        editor.isDestroyed() ||
        this.gutter !== gutter ||
        this.visibilityGeneration !== generation
      )
        return;
      const populated = editor
        .getDecorations({ gutterName: this.props.name })
        .some((decoration) => {
          const { type, item } = decoration.getProperties();
          // isType("gutter") also accepts line-number decorations. Only native
          // gutter items reserve this optional column, including off-screen ones.
          return (
            item != null && (type === "gutter" || (Array.isArray(type) && type.includes("gutter")))
          );
        });
      if (this.props.visible && populated) gutter.show();
      else gutter.hide();
    });
  }
  clearGutter() {
    this.visibilityGeneration++;
    this.pendingVisibilityCheck = null;
    this.gutterSubscriptions.dispose();
    this.gutterSubscriptions = new CompositeDisposable();
    const gutter = this.gutter;
    this.gutter = null;
    gutter?.destroy();
  }
  willDestroy() {
    this.subscription.dispose();
    this.clearGutter();
  }
}
