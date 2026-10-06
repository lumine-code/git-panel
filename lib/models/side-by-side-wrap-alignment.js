/** @babel */
import { CompositeDisposable } from "lumine";

const SIDES = ["old", "new"];

// Native screen rows remain the source of truth for wrapping and selection.
// Only the shorter side of a buffer row needs an extra block after its text.
export default class SideBySideWrapAlignment {
  constructor(view) {
    this.view = view;
    this.editors = SIDES.map((side) => view.editors[side].get());
    this.padding = SIDES.map(() => new Map());
    this.blocksByElement = new WeakMap();
    this.subs = new CompositeDisposable();
    this.selectionObserver = new MutationObserver((records) => {
      for (const { target } of records) {
        const block = this.blocksByElement.get(target);
        if (block) this.syncGutterSelection(block);
      }
    });
    this.resizeObserver = new ResizeObserver(() => this.schedule());
    for (const editor of this.editors) {
      this.subs.add(
        editor.onDidChangeSoftWrapped((wrapped) => {
          for (const other of this.editors)
            if (other !== editor && other.isSoftWrapped() !== wrapped)
              other.setSoftWrapped(wrapped);
          this.schedule(true);
        }),
        editor.displayLayer.onDidReset(() => this.schedule(true)),
        editor.displayLayer.onDidChange(() => this.schedule(true)),
        editor.getElement().onDidAttach(() => this.schedule()),
        editor.onDidChangeSelectionRange(() => this.scheduleSelectionSync()),
        editor.onDidAddSelection(() => this.scheduleSelectionSync()),
        editor.onDidRemoveSelection(() => this.scheduleSelectionSync()),
      );
      this.resizeObserver.observe(editor.getElement());
      this.selectionObserver.observe(editor.getElement(), {
        subtree: true,
        attributes: true,
        attributeFilter: ["data-block-decoration-selected"],
      });
      // Font metrics can change without resizing the editor viewport. Observe
      // the native measurement box, which alignment never resizes itself.
      this.resizeObserver.observe(
        editor.getElement().getComponent().refs.normalWidthCharacterSpan.parentNode,
      );
    }
    // The editor factory first applies its scoped settings after activation.
    // Set the diff's initial preference after that pass, then leave runtime
    // wrapping under the native command's control instead of a wrapper prop.
    void lumine.packages.getActivatePromise().then(() => {
      if (this.disposed) return;
      for (const editor of this.editors)
        editor.setSoftWrapped(this.view.props.initialSoftWrapped ?? true);
      this.schedule();
    });
    this.schedule();
  }

  schedule(geometryChanged = false) {
    if (geometryChanged) this.geometryPending = true;
    if (this.pending || this.disposed) return;
    this.pending = true;
    // A display reset can originate in the native viewport's ResizeObserver.
    // Reconcile in the next document write batch, outside observer delivery,
    // so changing padding never resizes a target in that same observer loop.
    lumine.views.updateDocument(() => {
      this.pending = false;
      if (!this.disposed) this.synchronize();
    });
  }

  lineHeight(editor, row) {
    const start = editor.screenRowForBufferRow(row);
    const end =
      row === editor.getLastBufferRow()
        ? editor.getScreenLineCount()
        : editor.screenRowForBufferRow(row + 1);
    return (end - start) * editor.getElement().getComponent().getLineHeight();
  }

  scheduleSelectionSync() {
    if (this.selectionPending || this.disposed) return;
    this.selectionPending = true;
    lumine.views.updateDocument(() => {
      this.selectionPending = false;
      if (this.disposed || this.view.destroyed) return;
      for (let index = 0; index < this.editors.length; index++) {
        const editor = this.editors[index];
        if (editor.isDestroyed()) continue;
        editor.getElement().getComponent().updateSync();
        for (const block of this.padding[index].values()) this.syncGutterSelection(block);
      }
    });
  }

  synchronize() {
    if (this.disposed || this.view.destroyed || this.editors.some((editor) => editor.isDestroyed()))
      return;
    const components = this.editors.map((editor) => editor.getElement().getComponent());
    if (components.some((component) => !component.hasInitialMeasurements)) return;
    const geometryChanged = this.geometryPending;
    this.geometryPending = false;
    const desired = SIDES.map(() => new Map());
    const rowCount = Math.min(...this.editors.map((editor) => editor.getLineCount()));
    for (let row = 0; row < rowCount; row++) {
      const heights = this.editors.map((editor) => this.lineHeight(editor, row));
      const difference = heights[0] - heights[1];
      if (difference < 0) desired[0].set(row, -difference);
      else if (difference > 0) desired[1].set(row, difference);
    }
    const previousSynchronization = this.view.synchronizingScroll;
    this.view.synchronizingScroll = true;
    try {
      let changed = false;
      for (let index = 0; index < SIDES.length; index++)
        changed = this.reconcile(index, desired[index]) || changed;
      if (!changed && !geometryChanged && !this.view.patchViewportRestoration) return;
      // Measure both sets of blocks before sharing an offset. Otherwise a
      // native scroll anchor can observe one side's intermediate content height.
      for (const component of components) component.updateSync();
      for (let index = 0; index < SIDES.length; index++)
        for (const [row, block] of this.padding[index]) this.styleGutterPadding(index, row, block);
      this.view.restoreInitialScrollAnchor?.();
      this.view.restorePatchViewport();
      const leaderIndex = SIDES.indexOf(this.view.activeSide);
      const top = components[leaderIndex].getScrollTop();
      for (const component of components) {
        component.setScrollTop(top);
        component.updateScrollAnimationFrame({ horizontal: false, vertical: true });
      }
      this.view.synchronizeSharedHeaders(this.view.activeSide);
      this.view.schedulePatchViewportRelease();
    } finally {
      this.view.synchronizingScroll = previousSynchronization;
    }
  }

  reconcile(index, desired) {
    const editor = this.editors[index];
    const component = editor.getElement().getComponent();
    const padding = this.padding[index];
    let changed = false;
    for (const [row, block] of padding) {
      const height = desired.get(row);
      if (height === undefined) {
        block.decoration.destroy();
        block.gutterDecoration.destroy();
        block.marker.destroy();
        padding.delete(row);
        changed = true;
        continue;
      }
      // Buffer replacements may move a surviving marker; retain its identity
      // and attach it to the end of the current row's last wrapped screen line.
      const position = block.marker.getHeadBufferPosition();
      const column = editor.lineTextForBufferRow(row).length;
      if (position.row !== row || position.column !== column) {
        block.marker.setHeadBufferPosition([row, column]);
        changed = true;
      }
      if (block.height !== height) {
        block.height = height;
        block.element.style.height = `${height}px`;
        component.invalidateBlockDecorationDimensions(block.decoration);
        changed = true;
      }
      this.stylePadding(index, row, block.element);
      this.styleGutterPadding(index, row, block);
      desired.delete(row);
    }
    for (const [row, height] of desired) {
      const element = document.createElement("div");
      this.stylePadding(index, row, element);
      element.style.height = `${height}px`;
      element.setAttribute("aria-hidden", "true");
      const marker = editor.markBufferPosition([row, editor.lineTextForBufferRow(row).length], {
        invalidate: "never",
      });
      const decoration = editor.decorateMarker(marker, {
        type: "block",
        position: "after",
        item: element,
      });
      const gutterItem = document.createElement("div");
      gutterItem.className = "git-panel-SideBySidePatchView-gutterPaddingItem";
      const gutterFill = document.createElement("div");
      gutterItem.appendChild(gutterFill);
      const gutterDecoration = editor.decorateMarker(marker, {
        type: "gutter",
        gutterName: `${SIDES[index]}-wrap-padding`,
        item: gutterItem,
      });
      // This empty block's exact height is owned here and every height change
      // is explicitly invalidated above. Automatic native resize observation
      // would only track its attachment/virtualization, not useful geometry.
      component.blockDecorationResizeObserver.unobserve(element);
      const block = {
        element,
        marker,
        decoration,
        height,
        gutterDecoration,
        gutterItem,
        gutterFill,
      };
      this.blocksByElement.set(element, block);
      this.styleGutterPadding(index, row, block);
      padding.set(row, block);
      changed = true;
    }
    return changed;
  }

  stylePadding(index, row, element) {
    const entry = this.view.projection.rows[row];
    const side = SIDES[index];
    const other = SIDES[1 - index];
    const classes = ["git-panel-SideBySidePatchView-wrapPadding"];
    if (entry?.[`${side}Row`] === null && entry[`${other}Row`] !== null) {
      classes.push("git-panel-SideBySidePatchView-placeholder");
    } else if (entry?.[`${side}Type`] === "added" || entry?.[`${side}Type`] === "deleted") {
      classes.push(`git-panel-FilePatchView-line--${entry[`${side}Type`]}`);
    }
    element.className = classes.join(" ");
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.selectionObserver.disconnect();
    this.subs.dispose();
    for (const padding of this.padding) {
      for (const block of padding.values()) {
        block.decoration.destroy();
        block.gutterDecoration.destroy();
        block.marker.destroy();
      }
      padding.clear();
    }
  }

  styleGutterPadding(index, row, block) {
    const component = this.editors[index].getElement().getComponent();
    this.stylePadding(index, row, block.gutterFill);
    block.gutterFill.classList.add("git-panel-SideBySidePatchView-gutterPadding");
    block.gutterFill.style.top = `${component.getLineHeight()}px`;
    block.gutterFill.style.width = `${component.getGutterContainerWidth()}px`;
    this.syncGutterSelection(block);
  }

  syncGutterSelection(block) {
    block.gutterFill.toggleAttribute(
      "data-block-decoration-selected",
      block.element.hasAttribute("data-block-decoration-selected"),
    );
  }
}
