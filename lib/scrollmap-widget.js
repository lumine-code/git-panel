const { CompositeDisposable, Disposable } = require("lumine");

const views = new Map();
const providers = new Map();
let Widget = null;

function selectProvider() {
  const next = [...providers.values()].at(-1) ?? null;
  if (next === Widget) return;
  Widget = next;
  for (const record of views.values()) {
    record.runtime?.destroy();
    record.runtime = Widget ? new PatchScrollmap(record.view, Widget) : null;
  }
}

exports.consumeScrollmapWidget = function consumeScrollmapWidget(Simplemap) {
  const token = {};
  providers.set(token, Simplemap);
  selectProvider();
  return new Disposable(() => {
    providers.delete(token);
    selectProvider();
  });
};

exports.addPatchScrollmap = function addPatchScrollmap(view) {
  views.get(view)?.runtime?.destroy();
  const record = { view, runtime: Widget ? new PatchScrollmap(view, Widget) : null };
  views.set(view, record);
  return new Disposable(() => {
    if (views.get(view) !== record) return;
    views.delete(view);
    record.runtime?.destroy();
  });
};

class PatchScrollmap {
  constructor(view, Simplemap) {
    this.view = view;
    this.Simplemap = Simplemap;
    this.editor = null;
    this.widget = null;
    this.frame = null;
    this.destroyed = false;
    this.signature = null;
    this.editorSubscriptions = new CompositeDisposable();
    this.subscriptions = new CompositeDisposable(
      view.observeScrollmapState(() => this.scheduleUpdate()),
      lumine.config.onDidChange("scrollmap.overlayWidth", () => this.scheduleUpdate()),
      lumine.themes.onDidChangeVariables(() => this.scheduleUpdate()),
    );
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.frame !== null) this.frameWindow.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.subscriptions.dispose();
    this.clearEditor();
    this.view = null;
  }

  scheduleUpdate() {
    if (this.destroyed) return;
    const element = this.view.getScrollmapEditor?.()?.getElement() ?? this.editor?.getElement();
    const window = element?.ownerDocument.defaultView ?? globalThis.window;
    if (this.frame !== null && this.frameWindow === window) return;
    if (this.frame !== null) this.frameWindow.cancelAnimationFrame(this.frame);
    this.frameWindow = window;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      this.frameWindow = null;
      this.update();
    });
  }

  clearEditor() {
    this.editorSubscriptions.dispose();
    this.editorSubscriptions = new CompositeDisposable();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.resizeWindow = null;
    this.widget?.destroy();
    this.widget = null;
    this.editor = null;
    this.signature = null;
  }

  setEditor(editor) {
    if (editor === this.editor) return;
    this.clearEditor();
    if (!editor || editor.isDestroyed()) return;
    this.editor = editor;
    const element = editor.getElement();
    const schedule = () => this.scheduleUpdate();
    this.widget = new this.Simplemap();
    this.widget.element.classList.add("git-panel-patch-scrollmap");
    element.appendChild(this.widget.element);
    this.bindResizeObserver();
    this.editorSubscriptions.add(
      editor.onDidAddDecoration(schedule),
      editor.onDidRemoveDecoration(schedule),
      editor.onDidUpdateDecorations(schedule),
      editor.onDidChangeSoftWrapped(schedule),
      editor.getBuffer().onDidChange(schedule),
      element.onDidChangeScrollTop(schedule),
      element.onDidAttach(() => {
        this.bindResizeObserver();
        schedule();
      }),
      editor.onDidDestroy(() => {
        this.clearEditor();
        this.scheduleUpdate();
      }),
    );
  }

  bindResizeObserver() {
    if (this.destroyed || !this.editor) return;
    const element = this.editor.getElement();
    const window = element.ownerDocument.defaultView;
    if (this.resizeWindow === window) return;
    this.resizeObserver?.disconnect();
    this.resizeWindow = window;
    const observer = new window.ResizeObserver(() => {
      if (this.resizeObserver === observer) this.scheduleUpdate();
    });
    this.resizeObserver = observer;
    observer.observe(element);
  }

  update() {
    if (this.destroyed) return;
    const state = this.view.getScrollmapState();
    this.setEditor(state?.editor ?? null);
    if (!this.widget) return;

    const component = this.editor.getElement().getComponent();
    const scrollHeight = component.getScrollHeight();
    const height = component.getScrollContainerClientHeight();
    const width =
      component.getVerticalScrollbarWidth() || lumine.config.get("scrollmap.overlayWidth") || 0;
    const bottom = component.getHorizontalScrollbarHeight();
    const items =
      scrollHeight > 0 && height > 0 && width > 0
        ? state.markers.flatMap((marker) => {
            if (!Number.isFinite(marker.top)) return [];
            const prc = clamp((marker.top / scrollHeight) * 100);
            const item = {
              prc,
              cls: `marker-git-${marker.level === 1 ? "file" : "hunk"}${marker.current ? " current" : ""}`,
            };
            return [item];
          })
        : [];
    const geometrySignature = JSON.stringify([
      height,
      width,
      bottom,
      this.editor.getElement().ownerDocument.defaultView.devicePixelRatio,
    ]);
    const signature = JSON.stringify([geometrySignature, items]);
    if (signature === this.signature) return;
    this.signature = signature;
    const style = this.widget.element.style;
    if (style.width !== `${width}px`) style.width = `${width}px`;
    if (style.height !== `${height}px`) style.height = `${height}px`;
    if (style.bottom !== `${bottom}px`) style.bottom = `${bottom}px`;
    this.widget.setItems(items);
  }
}

function clamp(value) {
  return Math.max(0, Math.min(100, value));
}
