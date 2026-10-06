/** @babel */
/** @jsx h */
import { CompositeDisposable, Disposable } from "lumine";
import { View, h, mount } from "../etch/view";
import Decoration from "../lumine/decoration";
import { holder } from "../etch/ownership";

// Native block items are clipped to the text viewport. Keep their exact
// reservation there, while rendering interactive controls over the full editor.
export class FullWidthBlockOverlay {
  constructor(editorHolder, layerHolder) {
    this.records = new Set();
    this.subs = new CompositeDisposable();
    this.editorSubs = new CompositeDisposable();
    this.layerHolder = layerHolder;
    this.resizeObserver = new ResizeObserver(() => this.scheduleMeasure());
    this.paintObserver = new MutationObserver(() => this.synchronize());
    this.subs.add(
      editorHolder.observe((editor) => this.setEditor(editor)),
      layerHolder.observe((layer) => {
        for (const record of this.records) layer.append(record.content);
        if (this.editor) this.setEditor(this.editor);
        this.scheduleMeasure();
      }),
    );
  }

  setEditor(editor) {
    if (this.editor !== editor) this.releaseViewport();
    this.editorSubs.dispose();
    this.editorSubs = new CompositeDisposable();
    this.paintObserver.disconnect();
    if (this.observedElement) this.resizeObserver.unobserve(this.observedElement);
    this.observedElement = null;
    this.editor = editor;
    if (!this.layerHolder.getOr(null)) return;
    const element = editor.getElement();
    this.observedElement = element;
    this.resizeObserver.observe(element);
    this.paintObserver.observe(element, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    this.editorSubs.add(
      element.onDidAttach(() => this.scheduleMeasure()),
      element.onDidChangeScrollTop(() => this.synchronize()),
      element.onDidChangeScrollLeft(() => this.synchronize()),
      editor.onDidDestroy(() => {
        this.paintObserver.disconnect();
        this.resizeObserver.unobserve(element);
        if (this.editor === editor) this.editor = null;
      }),
    );
    const releaseViewport = () => this.releaseViewport();
    for (const event of ["wheel", "mousedown", "keydown"]) {
      element.addEventListener(event, releaseViewport, { capture: true, passive: true });
      this.editorSubs.add(
        new Disposable(() => element.removeEventListener(event, releaseViewport, true)),
      );
    }
    this.scheduleMeasure();
  }

  register(record) {
    this.records.add(record);
    this.layerHolder.getOr(null)?.append(record.content);
    this.resizeObserver.observe(record.content);
    this.scheduleMeasure();
    return new Disposable(() => {
      this.records.delete(record);
      this.resizeObserver.unobserve(record.content);
      record.content.remove();
    });
  }

  scheduleMeasure() {
    if (this.pending || this.disposed) return;
    this.pending = true;
    lumine.views.updateDocument(() => {
      this.pending = false;
      if (!this.disposed) this.measure();
    });
  }

  preserveViewport(top, left) {
    if (!this.editor || this.editor.isDestroyed()) return;
    this.releaseViewport();
    const component = this.editor.getElement().getComponent();
    // Row zero is the stable pixel origin before any header blocks. Keep this
    // temporary anchor until the replacement headers have been measured.
    const anchor = { type: "row", bufferPosition: [0, 0], offset: -top };
    component.setScrollAnchor(anchor);
    this.viewportRestoration = { component, anchor, left };
    this.scheduleMeasure();
  }

  releaseViewport() {
    const restoration = this.viewportRestoration;
    this.viewportRestoration = null;
    if (!restoration) return;
    const { component, anchor } = restoration;
    for (const key of ["pendingScrollAnchor", "settlingScrollAnchor", "pendingReflowScrollAnchor"])
      if (component[key] === anchor) component[key] = null;
  }

  measure() {
    const editor = this.editor;
    const layer = this.layerHolder.getOr(null);
    if (!editor || editor.isDestroyed() || !layer?.isConnected) return;
    const element = editor.getElement();
    const component = element.getComponent();
    this.sizeLayer();
    const records = Array.from(this.records);
    const position = (record) =>
      holder(record.props.decorable).getOr(null)?.getStartBufferPosition();
    records.sort((a, b) => {
      const ap = position(a);
      const bp = position(b);
      return (
        (ap?.row || 0) - (bp?.row || 0) ||
        (ap?.column || 0) - (bp?.column || 0) ||
        Number(a.props.position === "after") - Number(b.props.position === "after") ||
        (a.props.order || 0) - (b.props.order || 0)
      );
    });
    let changed = false;
    for (const [index, record] of records.entries()) {
      const previous = records[index - 1];
      const point = position(record);
      const previousPoint = previous && position(previous);
      const adjacent =
        point &&
        previousPoint &&
        point.isEqual(previousPoint) &&
        (record.props.position || "before") === (previous.props.position || "before");
      record.content.classList.toggle(
        "git-panel-FilePatchView-controlBlock--adjacent",
        Boolean(adjacent),
      );
      const decoration = record.decoration?.decorationHolder.getOr(null);
      if (decoration !== record.nativeDecoration) {
        record.nativeDecoration = decoration;
        if (decoration)
          component.blockDecorationResizeObserver.unobserve(record.decoration.domNode);
      }
      const height = record.content.getBoundingClientRect().height;
      if (!record.spacer || !decoration || record.height === height) continue;
      record.height = height;
      record.spacer.style.height = `${height}px`;
      component.invalidateBlockDecorationDimensions(decoration);
      changed = true;
    }
    if (changed || this.viewportRestoration) {
      component.updateSync();
      const anchor = component.pendingScrollAnchor || component.settlingScrollAnchor;
      if (anchor) {
        component.restoreScrollAnchor(anchor);
        const restoresViewport = anchor === this.viewportRestoration?.anchor;
        if (restoresViewport) component.setScrollLeft(this.viewportRestoration.left);
        component.updateScrollAnimationFrame({ horizontal: restoresViewport, vertical: true });
      }
      this.releaseViewport();
    }
    this.synchronize();
  }

  sizeLayer() {
    const layer = this.layerHolder.getOr(null);
    const element = this.editor?.getElement();
    if (!element || !layer?.parentElement) return;
    const area = layer.parentElement.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    layer.style.left = `${rect.left - area.left}px`;
    layer.style.right = `${area.right - rect.right + element.getVerticalScrollbarWidth()}px`;
    layer.style.height = `${element.getHeight() - element.getHorizontalScrollbarHeight()}px`;
  }

  synchronize() {
    const layer = this.layerHolder.getOr(null);
    const editor = this.editor;
    if (this.disposed || !layer?.isConnected || !editor || editor.isDestroyed()) return;
    this.sizeLayer();
    const area = layer.getBoundingClientRect();
    const tiles = editor.getElement().getComponent().refs.lineTiles;
    for (const record of this.records) {
      const spacer = record.spacer;
      const top =
        spacer?.isConnected && tiles.contains(spacer)
          ? spacer.getBoundingClientRect().top - area.top
          : Infinity;
      const visible = top < area.height && top + (record.height || 0) > 0;
      record.content.style.visibility = visible ? "visible" : "hidden";
      if (visible) record.content.style.transform = `translateY(${top}px)`;
    }
  }

  dispose() {
    this.disposed = true;
    this.releaseViewport();
    this.subs.dispose();
    this.editorSubs.dispose();
    this.resizeObserver.disconnect();
    this.paintObserver.disconnect();
    this.records.clear();
    this.editor = null;
  }
}

export default class FullWidthBlockDecoration extends View {
  constructor(props, children) {
    super(props, children);
    this.content = document.createElement("div");
    this.content.className = "git-panel-FilePatchView-controlBlock git-panel-FullWidthBlock";
    this.contentView = mount(this.props.children, this.content);
    this.content.addEventListener("wheel", this.didMouseWheel, { passive: false });
    this.content.addEventListener("mousedown", () => this.props.portal.releaseViewport(), true);
    this.content.addEventListener("mousedown", (event) => {
      if (
        event.target.closest(".git-panel-HunkHeaderView") &&
        event.button === 0 &&
        !(event.ctrlKey && process.platform !== "win32")
      ) {
        event.preventDefault();
        holder(this.props.editor).getOr(null)?.getElement().focus();
      }
    });
    this.initialize();
  }

  render() {
    return (
      <Decoration
        {...this.props}
        children={undefined}
        ref={(decoration) => (this.decoration = decoration)}
      >
        <div
          ref={(spacer) => (this.spacer = spacer)}
          style={{ height: `${this.height || 0}px` }}
          attributes={{ "aria-hidden": "true" }}
        />
      </Decoration>
    );
  }

  didMount() {
    this.registration = this.props.portal.register(this);
  }

  didUpdate() {
    this.contentView.update(this.props.children);
    this.props.portal.scheduleMeasure();
  }

  didMouseWheel = (event) => {
    this.props.portal.releaseViewport();
    const editor = holder(this.props.editor).getOr(null);
    if (!editor || editor.isDestroyed()) return;
    const component = editor.getElement().getComponent();
    const { x, y } = component.normalizedWheelDeltas(event);
    if (component.applyWheelScroll(x, y)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  willDestroy() {
    this.registration?.dispose();
    this.contentView.destroy();
    this.content.remove();
  }
}
