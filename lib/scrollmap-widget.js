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
      lumine.themes.onDidChangeVariables(() => this.scheduleUpdate()),
    );
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.frame?.dispose();
    this.frame = null;
    this.subscriptions.dispose();
    this.clearEditor();
    this.view = null;
  }

  scheduleUpdate() {
    if (this.destroyed) return;
    if (this.frame !== null) return;
    this.frame = lumine.views.readDocument(() => {
      this.frame = null;
      this.update();
    });
  }

  clearEditor() {
    this.editorSubscriptions.dispose();
    this.editorSubscriptions = new CompositeDisposable();
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
    this.widget.setScrollElement?.(element);
    const track = lumine.scrollbars.getVerticalTrack(element);
    (track ?? element).appendChild(this.widget.element);
    this.editorSubscriptions.add(
      editor.onDidAddDecoration(schedule),
      editor.onDidRemoveDecoration(schedule),
      editor.onDidUpdateDecorations(schedule),
      editor.onDidChangeSoftWrapped(schedule),
      editor.getBuffer().onDidChange(schedule),
      // Moving the thumb does not change file/hunk positions. Geometry has a
      // separate signal, including rewrap and detached-window adoption.
      lumine.scrollbars.observe(element, schedule),
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

    const element = this.editor.getElement();
    const geometry = lumine.scrollbars.getGeometry(element);
    const scrollHeight = geometry.scrollHeight;
    const height = geometry.viewportHeight;
    const width = geometry.verticalSize;
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
    const signature = [height, width, element.ownerDocument.defaultView.devicePixelRatio];
    if (
      this.signature?.every((value, index) => value === signature[index]) &&
      this.items?.length === items.length &&
      items.every(
        (item, index) => item.prc === this.items[index].prc && item.cls === this.items[index].cls,
      )
    )
      return;
    this.signature = signature;
    this.items = items;
    const track = lumine.scrollbars.getVerticalTrack(element);
    if (track && this.widget.element.parentNode !== track) track.appendChild(this.widget.element);
    const style = this.widget.element.style;
    if (style.width !== `${width}px`) style.width = `${width}px`;
    if (style.height !== `${height}px`) style.height = `${height}px`;
    this.widget.setItems(items);
  }
}

function clamp(value) {
  return Math.max(0, Math.min(100, value));
}
