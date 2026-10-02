/** @babel */
import { Disposable } from "lumine";
import View, { h } from "../etch/view";
import { holder, bindChildren } from "../etch/ownership";
import RefHolder from "../models/ref-holder";
import { extractProps } from "../helpers";

export default class MarkerLayer extends View {
  static defaultProps = { handleLayer() {}, handleID() {} };
  constructor(props, children) {
    super(props, children);
    this.editorHolder = holder(this.props.editor);
    this.layerHolder = new RefHolder();
    this.editorSub = new Disposable();
    this.ownedLayer = null;
    this.initialize();
  }

  render() {
    return h(
      "span",
      { style: { display: "contents" } },
      bindChildren(this.props.children, {
        editor: this.editorHolder,
        layer: this.layerHolder,
        decorable: this.layerHolder,
        decorateMethod: "decorateMarkerLayer",
      }),
    );
  }

  update(props, children) {
    if (props.editor !== this.props.editor) this.editorHolder = holder(props.editor);
    return super.update(props, children);
  }

  didMount() {
    this.observeEditor();
  }
  didUpdate(previous) {
    if (
      ["editor", "external", "maintainHistory", "persistent"].some(
        (key) => previous[key] !== this.props[key],
      )
    )
      this.observeEditor();
  }

  observeEditor() {
    this.editorSub.dispose();
    this.clearLayer();
    this.editorHolder = holder(this.props.editor);
    this.editorSub = this.editorHolder.observe((editor) => {
      if (this.destroyed || editor.isDestroyed()) return;
      this.clearLayer();
      let layer;
      if (this.props.external) {
        layer = editor.getMarkerLayer(this.props.external.id);
        if (
          !layer ||
          (layer !== this.props.external && layer.bufferMarkerLayer !== this.props.external)
        )
          return;
      } else {
        layer = editor.addMarkerLayer(
          extractProps(this.props, { maintainHistory: true, persistent: true }),
        );
        this.ownedLayer = layer;
      }
      this.layerHolder.setter(layer);
      this.props.handleLayer(layer);
      this.props.handleID(layer.id);
    });
  }

  clearLayer() {
    if (this.ownedLayer && !this.ownedLayer.isDestroyed()) this.ownedLayer.destroy();
    this.ownedLayer = null;
    this.layerHolder.setter(null);
  }

  willDestroy() {
    this.editorSub.dispose();
    this.clearLayer();
    this.props.handleLayer(undefined);
    this.props.handleID(undefined);
  }
}
