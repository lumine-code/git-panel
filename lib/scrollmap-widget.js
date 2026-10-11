/** @babel */
import { CompositeDisposable, Disposable } from "lumine";

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

export function consumeScrollmapWidget(Simplemap) {
  const token = {};
  providers.set(token, Simplemap);
  selectProvider();
  return new Disposable(() => {
    providers.delete(token);
    selectProvider();
  });
}

export function addPatchScrollmap(view) {
  views.get(view)?.runtime?.destroy();
  const record = { view, runtime: Widget ? new PatchScrollmap(view, Widget) : null };
  views.set(view, record);
  return new Disposable(() => {
    if (views.get(view) !== record) return;
    views.delete(view);
    record.runtime?.destroy();
  });
}

class PatchScrollmap {
  constructor(view, Simplemap) {
    this.view = view;
    this.Simplemap = Simplemap;
    this.editor = null;
    this.widget = null;
    this.frame = null;
    this.destroyed = false;
    this.signature = null;
    this.geometrySignature = null;
    this.editorSubscriptions = new CompositeDisposable();
    this.resizeObserver = new ResizeObserver(() => this.scheduleUpdate());
    this.subscriptions = new CompositeDisposable(
      view.observeScrollmapState(() => this.scheduleUpdate()),
      lumine.config.onDidChange("scrollmap.overlayWidth", () => this.scheduleUpdate()),
      lumine.themes.onDidChangeVariables(() => this.scheduleUpdate()),
    );
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.subscriptions.dispose();
    this.clearEditor();
    this.view = null;
  }

  scheduleUpdate() {
    if (this.destroyed || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.update();
    });
  }

  clearEditor() {
    this.editorSubscriptions.dispose();
    this.editorSubscriptions = new CompositeDisposable();
    this.resizeObserver.disconnect();
    this.widget?.destroy();
    this.widget = null;
    this.editor = null;
    this.signature = null;
    this.geometrySignature = null;
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
    this.resizeObserver.observe(element);
    this.editorSubscriptions.add(
      editor.onDidAddDecoration(schedule),
      editor.onDidRemoveDecoration(schedule),
      editor.onDidUpdateDecorations(schedule),
      editor.onDidChangeSoftWrapped(schedule),
      editor.getBuffer().onDidChange(schedule),
      element.onDidChangeScrollTop(schedule),
      element.onDidAttach(schedule),
      editor.onDidDestroy(() => {
        this.clearEditor();
        this.scheduleUpdate();
      }),
    );
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
              height: (component.getLineHeight() / scrollHeight) * height,
              cls: `marker-git-${marker.level === 1 ? "file" : "hunk"}${marker.current ? " current" : ""}`,
            };
            if (Number.isFinite(marker.end)) {
              item.end = Math.max(prc, clamp((marker.end / scrollHeight) * 100));
            }
            return [item];
          })
        : [];
    const geometrySignature = JSON.stringify([height, width, bottom, window.devicePixelRatio]);
    const signature = JSON.stringify([geometrySignature, items]);
    if (signature === this.signature) return;
    this.signature = signature;
    const style = this.widget.element.style;
    if (style.width !== `${width}px`) style.width = `${width}px`;
    if (style.height !== `${height}px`) style.height = `${height}px`;
    if (style.bottom !== `${bottom}px`) style.bottom = `${bottom}px`;
    if (geometrySignature !== this.geometrySignature) {
      this.geometrySignature = geometrySignature;
      this.widget.update();
    }
    this.widget.setItems(items);
  }
}

function clamp(value) {
  return Math.max(0, Math.min(100, value));
}
