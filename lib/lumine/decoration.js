/** @babel */
import { CompositeDisposable, Disposable } from "lumine";
import View, { h, mount } from "../etch/view";
import { holder } from "../etch/ownership";
import RefHolder from "../models/ref-holder";
import { createItem, extractProps } from "../helpers";

const optionProps = {
  type: true,
  className: true,
  style: true,
  onlyHead: true,
  onlyEmpty: true,
  onlyNonEmpty: true,
  omitEmptyLastRow: true,
  position: true,
  order: true,
  avoidOverflow: true,
  gutterName: true,
};
export default class Decoration extends View {
  static defaultProps = { decorateMethod: "decorateMarker" };
  constructor(props, children) {
    super(props, children);
    this.decorationHolder = new RefHolder();
    this.subscriptions = new CompositeDisposable();
    this.gutterSub = new Disposable();
    this.domNode = null;
    this.contentView = null;
    this.initialize();
  }
  render() {
    return h("span", { hidden: true });
  }
  didMount() {
    this.setupContent();
    this.observeParents();
  }
  didUpdate(previous) {
    if (this.domNode)
      this.domNode.className = "git-panel-Decoration " + (this.props.className || "");
    if (previous.type !== this.props.type) this.setupContent();
    else this.contentView?.update(this.props.children);
    if (
      ["editor", "decorable", "decorateMethod", ...Object.keys(optionProps)].some(
        (key) => previous[key] !== this.props[key],
      )
    )
      this.observeParents();
  }

  setupContent() {
    this.contentView?.destroy();
    this.contentView = null;
    this.domNode?.remove();
    this.domNode = null;
    this.item = null;
    if (["gutter", "overlay", "block"].includes(this.props.type)) {
      this.domNode = document.createElement("div");
      this.domNode.className = "git-panel-Decoration " + (this.props.className || "");
      this.contentView = mount(this.props.children, this.domNode);
      this.item = createItem(this.domNode, this.props.itemHolder);
    }
  }

  clearDecoration() {
    this.decorationHolder.map((decoration) => decoration.destroy());
    this.decorationHolder.setter(null);
  }

  observeParents() {
    this.subscriptions.dispose();
    this.subscriptions = new CompositeDisposable();
    this.gutterSub.dispose();
    this.clearDecoration();
    this.editorHolder = holder(this.props.editor);
    this.decorableHolder = holder(this.props.decorable);
    this.subscriptions.add(
      this.editorHolder.observe(this.createDecoration),
      this.decorableHolder.observe(this.createDecoration),
    );
  }

  createDecoration = () => {
    if (this.destroyed) return;
    this.gutterSub.dispose();
    this.clearDecoration();
    const editor = this.editorHolder.getOr(null);
    const decorable = this.decorableHolder.getOr(null);
    if (!editor || !decorable || editor.isDestroyed() || decorable.isDestroyed()) return;
    const layer = decorable.layer || decorable;
    const displayLayer = editor.getMarkerLayer(layer.id);
    if (!displayLayer || (displayLayer !== layer && displayLayer.bufferMarkerLayer !== layer))
      return;
    const decorate = () => {
      if (this.destroyed || editor.isDestroyed() || decorable.isDestroyed()) return;
      this.clearDecoration();
      const options = {
        ...extractProps(this.props, optionProps, { className: "class" }),
        item: this.item,
      };
      this.decorationHolder.setter(editor[this.props.decorateMethod](decorable, options));
    };
    if (this.props.type === "gutter") {
      if (!this.props.gutterName) throw new Error("A gutter decoration requires gutterName.");
      this.gutterSub = editor.observeGutters((gutter) => {
        if (gutter.name === this.props.gutterName) decorate();
      });
    } else decorate();
  };

  willDestroy() {
    this.subscriptions.dispose();
    this.gutterSub.dispose();
    this.clearDecoration();
    this.contentView?.destroy();
    this.domNode?.remove();
  }
}
