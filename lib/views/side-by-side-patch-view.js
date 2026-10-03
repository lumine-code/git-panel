/** @babel */
/** @jsx h */
import { CompositeDisposable, Disposable, Range, Point, TextBuffer } from "lumine";
import { View, h, Fragment } from "../etch/view";
import RefHolder from "../models/ref-holder";
import { NBSP_CHARACTER, blankLabel } from "../helpers";
import SideBySideWrapAlignment from "../models/side-by-side-wrap-alignment";
import buildSideBySidePatch from "../models/patch/side-by-side";
import LumineTextEditor from "../lumine/lumine-text-editor";
import Gutter from "../lumine/gutter";
import Marker from "../lumine/marker";
import Decoration from "../lumine/decoration";

const SIDES = ["old", "new"];

// Both editors use aligned display rows. All public selection methods speak the
// original patch's buffer coordinates, which staging and discard depend on.
export default class SideBySidePatchView extends View {
  constructor(props, children) {
    super(props, children);
    this.projection = buildSideBySidePatch(props.multiFilePatch);
    this.projectionGeneration = 0;
    this.renderStatuses = props.multiFilePatch
      .getFilePatches()
      .map((patch) => patch.getRenderStatus());
    this.buffers = {
      old: new TextBuffer({ text: this.projection.oldText }),
      new: new TextBuffer({ text: this.projection.newText }),
    };
    this.editors = { old: new RefHolder(), new: new RefHolder() };
    this.sharedHeaderRecords = new Map();
    this.sharedHeaders = [];
    this.nextSharedHeaderId = 0;
    this.subs = new CompositeDisposable();
    this.suppressSelections = true;
    this.activeSide = "new";
    this.canonicalRanges = (props.initialRanges || []).map((range) => Range.fromObject(range));
    this.initialize();
  }

  didMount() {
    this.observeSharedHeaders();
    this.wrapAlignment = new SideBySideWrapAlignment(this);
    for (const side of SIDES) {
      const editor = this.editors[side].get();
      const element = editor.getElement();
      const focus = () => {
        this.activeSide = side;
      };
      const wheel = (event) => this.didMouseWheel(side, event);
      const releaseAnchor = () => this.releaseInitialScrollAnchor();
      element.addEventListener("focusin", focus);
      element.addEventListener("wheel", wheel, { capture: true, passive: false });
      element.addEventListener("mousedown", releaseAnchor, true);
      this.subs.add(
        new Disposable(() => element.removeEventListener("focusin", focus)),
        new Disposable(() => element.removeEventListener("wheel", wheel, true)),
        new Disposable(() => element.removeEventListener("mousedown", releaseAnchor, true)),
        element.onDidChangeScrollTop(() => this.synchronizeScroll(side, "Top")),
        element.onDidChangeScrollLeft(() => this.synchronizeScroll(side, "Left")),
      );
      if (side === "old") this.subs.add(lumine.textEditors.add(editor, { role: "viewer" }));
    }
    this.props.refEditor.setter(this.editors.new.get());
    this.setCanonicalSelectionRanges(this.canonicalRanges, { autoscroll: false, notify: false });
    this.restoreCanonicalScrollAnchor(this.props.initialScrollAnchor);
    this.suppressSelections = false;
  }

  captureCanonicalScrollAnchor() {
    const side = this.activeSide;
    const component = this.editors[side].get().getElement().getComponent();
    let anchor = component.captureScrollAnchor({ anchorTop: true });
    if (!anchor || anchor.type !== "row") return anchor;
    const entry = this.projection.rows[anchor.bufferPosition.row];
    let patchRow = entry?.[`${side}Row`];
    let anchorSide = side;
    // A placeholder has no source coordinate. The other column supplies the
    // visible wrapped text rather than treating that blank row as patch row 0.
    if (patchRow == null || this.viewportStartsInWrapPadding(side, anchor.bufferPosition.row)) {
      const other = side === "old" ? "new" : "old";
      const otherAnchor = this.editors[other]
        .get()
        .getElement()
        .getComponent()
        .captureScrollAnchor({ anchorTop: true });
      const otherEntry = this.projection.rows[otherAnchor?.bufferPosition?.row];
      if (otherAnchor?.type === "row" && otherEntry?.[`${other}Row`] != null) {
        anchor = otherAnchor;
        patchRow = otherEntry[`${other}Row`];
        anchorSide = other;
      } else {
        patchRow = entry?.filePatch.getStartRange().start.row;
      }
    }
    if (patchRow == null) return null;
    return {
      ...anchor,
      bufferPosition: new Point(patchRow, anchor.bufferPosition.column),
      side: anchorSide,
    };
  }

  restoreCanonicalScrollAnchor(anchor) {
    if (!anchor) return;
    if (anchor.type !== "row") {
      this.editors.new.get().getElement().getComponent().setScrollAnchor(anchor);
      return;
    }
    const position = anchor.bufferPosition;
    let row = this.projection.patchRowToDisplayRow.get(position.row);
    if (row === undefined) {
      // A collapsed or metadata-only file still has a header anchor even
      // though it contributes no selectable text to the patch buffer.
      const filePatch = this.props.multiFilePatch.getFilePatchAt(position.row);
      row = this.projection.fileRanges.get(filePatch)?.[0];
    }
    if (row === undefined) return;
    const entry = this.projection.rows[row];
    const preferred = anchor.side || this.activeSide;
    const side =
      entry[`${preferred}Row`] === position.row
        ? preferred
        : SIDES.find((candidate) => entry[`${candidate}Row`] === position.row) || preferred;
    this.activeSide = side;
    const editor = this.editors[side].get();
    const component = editor.getElement().getComponent();
    const mappedAnchor = {
      ...anchor,
      bufferPosition: editor.clipBufferPosition([row, position.column]),
    };
    this.initialScrollAnchor = {
      component,
      anchor: mappedAnchor,
      leftColumn: this.props.initialScrollLeftColumn || 0,
    };
    component.setScrollAnchor(mappedAnchor);
    const leftColumn = this.props.initialScrollLeftColumn || 0;
    for (const candidate of SIDES)
      this.editors[candidate].get().getElement().getComponent().setScrollLeftColumn(leftColumn);
  }

  viewportStartsInWrapPadding(side, row) {
    const padding = this.wrapAlignment?.padding[SIDES.indexOf(side)];
    if (!padding) return false;
    const top = this.editors[side]
      .get()
      .getElement()
      .getComponent()
      .refs.scrollContainer.getBoundingClientRect().top;
    for (const candidate of [row, row - 1]) {
      const element = padding.get(candidate)?.element;
      if (!element?.isConnected) continue;
      const rect = element.getBoundingClientRect();
      if (rect.height > 0 && rect.top <= top && top < rect.bottom) return true;
    }
    return false;
  }

  restoreInitialScrollAnchor() {
    const pending = this.initialScrollAnchor;
    if (!pending || this.destroyed) return;
    const { component, anchor } = pending;
    // Geometry can settle after the first native paint. Keep the inherited
    // content anchor authoritative only until native scrolling releases it.
    if (component.pendingScrollAnchor !== anchor && component.settlingScrollAnchor !== anchor) {
      this.initialScrollAnchor = null;
      return;
    }
    component.restoreScrollAnchor(anchor);
    // Scoped wrapping is applied asynchronously by the native editor factory.
    // Re-apply the remembered horizontal column after that measurement pass.
    for (const side of SIDES)
      this.editors[side].get().getElement().getComponent().setScrollLeftColumn(pending.leftColumn);
  }

  releaseInitialScrollAnchor() {
    const pending = this.initialScrollAnchor;
    if (!pending) return;
    this.initialScrollAnchor = null;
    const { component, anchor } = pending;
    if (component.pendingScrollAnchor === anchor) component.pendingScrollAnchor = null;
    if (component.settlingScrollAnchor === anchor) component.settlingScrollAnchor = null;
    if (component.pendingReflowScrollAnchor === anchor) component.pendingReflowScrollAnchor = null;
  }

  didMouseWheel(side, event) {
    this.releaseInitialScrollAnchor();
    const components = SIDES.map((entry) => this.editors[entry].get().getElement().getComponent());
    // One animation clock for gestures on either column. The longer horizontal
    // range also lets removed lines remain reachable when After is shorter.
    const leader =
      components[0].getMaxScrollLeft() > components[1].getMaxScrollLeft()
        ? components[0]
        : components[1];
    const source = components[SIDES.indexOf(side)];
    const { x, y } = source.normalizedWheelDeltas(event);
    if (leader.applyWheelScroll(x, y)) {
      for (const component of components)
        if (component !== leader) component.scrollAnimator.cancel();
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  synchronizeScroll(side, axis) {
    if (this.synchronizingScroll || this.destroyed || this.wrapAlignment?.geometryPending) return;
    const other = side === "old" ? "new" : "old";
    this.synchronizingScroll = true;
    try {
      const source = this.editors[side].get().getElement();
      const follower = this.editors[other].get().getElement().getComponent();
      if (follower[`setScroll${axis}`](source[`getScroll${axis}`]())) {
        // The leader paints its animation immediately. Paint the follower in
        // that same frame instead of scheduling it for the next document frame.
        follower.updateScrollAnimationFrame({
          horizontal: axis === "Left",
          vertical: axis === "Top",
        });
      }
      this.synchronizeSharedHeaders(other);
    } finally {
      this.synchronizingScroll = false;
    }
  }

  update(props, children) {
    if (this.destroyed) return Promise.resolve();
    const statuses = props.multiFilePatch.getFilePatches().map((patch) => patch.getRenderStatus());
    if (
      props.multiFilePatch === this.props.multiFilePatch &&
      statuses.every((status, i) => status === this.renderStatuses[i])
    )
      return super.update(props, children);
    const { index, viewport, hasSelection } =
      this.pendingPatchUpdate || this.prepareForPatchUpdate();
    this.pendingPatchUpdate = null;
    this.renderStatuses = statuses;
    const generation = ++this.projectionGeneration;
    this.suppressSelections = true;
    this.projection = buildSideBySidePatch(props.multiFilePatch);
    for (const side of SIDES) this.buffers[side].setText(this.projection[`${side}Text`]);
    return super.update(props, children).then(() => {
      if (this.destroyed || generation !== this.projectionGeneration) return;
      const range = Range.fromObject(props.multiFilePatch.getSelectionRangeForIndex(index));
      const hunks = new Set(
        range
          .getRows()
          .map((row) => props.multiFilePatch.getHunkAt(row))
          .filter(Boolean),
      );
      const ranges = !hasSelection
        ? []
        : props.selectionMode === "hunk" && hunks.size
          ? Array.from(hunks, (hunk) => hunk.getRange())
          : [range];
      this.setCanonicalSelectionRanges(ranges, { autoscroll: false, notify: false });
      SIDES.forEach((side, i) => {
        const element = this.editors[side].get().getElement();
        element.setScrollTop(props.multiFilePatch.getBuffer().isEmpty() ? 0 : viewport[i][0]);
        element.setScrollLeft(viewport[i][1]);
      });
      this.suppressSelections = false;
      this.props.selectedRangesChanged(props.selectionMode);
    });
  }

  prepareForPatchUpdate() {
    this.releaseInitialScrollAnchor();
    const index = this.props.multiFilePatch.getMaxSelectionIndex(this.props.selectedRows);
    const viewport = SIDES.map((side) => {
      const element = this.editors[side].get().getElement();
      return [element.getScrollTop(), element.getScrollLeft()];
    });
    this.pendingPatchUpdate = { index, viewport, hasSelection: this.canonicalRanges.length > 0 };
    return this.pendingPatchUpdate;
  }

  render() {
    this.collectSharedHeaders();
    return (
      <div className="git-panel-SideBySidePatchView">
        <div className="git-panel-SideBySidePatchView-editors" ref="editorArea">
          {SIDES.map((side) => this.renderSide(side))}
          <div
            className="git-panel-SideBySidePatchView-sharedHeaders"
            ref="sharedHeaders"
            onWheel={(event) => this.didMouseWheel(this.activeSide, event)}
          >
            {this.sharedHeaders.map((record, index) => this.renderSharedHeader(record, index))}
          </div>
        </div>
      </div>
    );
  }

  renderSide(side) {
    const ref = this.editors[side];
    return (
      <div
        className="git-panel-SideBySidePatchView-column"
        key={side}
        attributes={{ "data-diff-side": side }}
      >
        <LumineTextEditor
          buffer={this.buffers[side]}
          refModel={ref}
          readOnly={true}
          maxScreenLineLength={Infinity}
          lineNumberGutterVisible={false}
          autoHeight={false}
          autoWidth={false}
          scrollPastEnd={false}
          didAddSelection={() => this.didChangeSelection(side)}
          didChangeSelectionRange={(event) => this.didChangeSelection(side, event)}
          didDestroySelection={() => this.didChangeSelection(side)}
        >
          <Gutter editor={ref} name={`${side}-wrap-padding`} priority={0} />
          <Gutter
            editor={ref}
            name={`${side}-line-numbers`}
            className={side}
            priority={1}
            type="line-number"
            labelFn={({ bufferRow, softWrapped }) => {
              const number = this.projection.rows[bufferRow]?.[`${side}LineNumber`];
              return number == null ? NBSP_CHARACTER : softWrapped ? "•" : String(number);
            }}
            onMouseDown={(event) => this.didMouseDownOnLineNumber(side, event)}
            onMouseMove={(event) => this.didMouseMoveOnLineNumber(side, event)}
          />
          {this.props.config.get("git-panel.showDiffIconGutter") && (
            <Gutter
              editor={ref}
              name="diff-icons"
              className="icons"
              priority={2}
              type="line-number"
              labelFn={blankLabel}
              onMouseDown={(event) => this.didMouseDownOnLineNumber(side, event)}
              onMouseMove={(event) => this.didMouseMoveOnLineNumber(side, event)}
            />
          )}
          {this.sharedHeaders.map((record) => (
            <Marker
              editor={ref}
              key={record.key}
              bufferRange={[
                [record.row, 0],
                [record.row, 0],
              ]}
              invalidate="never"
            >
              <Decoration
                ref={(decoration) => {
                  record.decorations[side] = decoration;
                  // Spacer dimensions are mirrored from the shared header and
                  // explicitly invalidated; virtualization changes no height.
                  if (decoration)
                    this.editors[side]
                      .get()
                      .getElement()
                      .getComponent()
                      .blockDecorationResizeObserver.unobserve(decoration.domNode);
                }}
                editor={ref}
                type="block"
                position="before"
                order={record.kind === "file" ? 0 : 0.2}
                className="git-panel-SideBySidePatchView-headerSpacer"
              >
                <div
                  ref={(node) => (record.spacers[side] = node)}
                  style={{ height: `${record.height || 0}px` }}
                  attributes={{ "aria-hidden": "true" }}
                />
              </Decoration>
            </Marker>
          ))}
          {this.renderLineDecorations(side)}
          {this.renderWordDecorations(side)}
        </LumineTextEditor>
      </div>
    );
  }

  collectSharedHeaders() {
    const records = new Map();
    const headers = [];
    const collect = (model, range, kind) => {
      const record = this.sharedHeaderRecords.get(model) || {
        model,
        kind,
        // Indices change when an earlier file expands. Retain a model's key
        // while giving every new header generation its own DOM and spacers.
        key: `header-${this.nextSharedHeaderId++}`,
        spacers: {},
        decorations: {},
        height: 0,
      };
      record.row = range[0];
      records.set(model, record);
      headers.push(record);
    };
    if (!this.props.compact) {
      Array.from(this.projection.fileRanges).forEach(([model, range]) =>
        collect(model, range, "file"),
      );
      Array.from(this.projection.hunkRanges).forEach(([model, range]) =>
        collect(model, range, "hunk"),
      );
    }
    for (const [model, record] of this.sharedHeaderRecords) {
      if (!records.has(model) && record.element)
        this.headerResizeObserver?.unobserve(record.element);
    }
    headers.sort((a, b) => a.row - b.row || (a.kind === "file" ? -1 : 1));
    this.sharedHeaderRecords = records;
    this.sharedHeaders = headers;
  }

  renderSharedHeader(record, index) {
    const { model, kind } = record;
    // The overlay's siblings may be many source lines apart. Only controls
    // sharing a native block anchor get unified's adjacent-block spacing.
    const adjacent = this.sharedHeaders[index - 1]?.row === record.row;
    return (
      <div
        key={record.key}
        ref={(node) => {
          if (record.element === node) return;
          if (record.element) this.headerResizeObserver?.unobserve(record.element);
          record.element = node;
          if (node) this.headerResizeObserver?.observe(node);
        }}
        className={`git-panel-FilePatchView-controlBlock git-panel-SideBySidePatchView-sharedHeader git-panel-SideBySidePatchView-sharedHeader--${kind}${adjacent ? " git-panel-FilePatchView-controlBlock--adjacent" : ""}`}
        onMouseDown={(event) => {
          if (
            kind === "hunk" &&
            event.button === 0 &&
            !(event.ctrlKey && process.platform !== "win32")
          ) {
            event.preventDefault();
            this.focus();
          }
        }}
      >
        {kind === "hunk" ? this.props.renderHunkHeader(model) : this.renderSharedFileHeader(model)}
      </div>
    );
  }

  renderSharedFileHeader(patch) {
    return (
      <Fragment>
        {this.props.renderFileHeader(patch)}
        {patch.getRenderStatus().isVisible() ? (
          <Fragment>
            {this.props.renderSymlinkChangeMeta(patch)}
            {this.props.renderExecutableModeChangeMeta(patch)}
          </Fragment>
        ) : (
          <p className="git-panel-FilePatchView-message icon icon-info">
            {patch.getRenderStatus().isExpandable() ? (
              <Fragment>
                Large diffs are collapsed by default for performance reasons.
                <br />
                <button
                  className="git-panel-FilePatchView-showDiffButton"
                  onClick={() => this.props.expandFilePatch(patch)}
                >
                  Load Diff
                </button>
              </Fragment>
            ) : (
              "This diff is too large to load at all. Use the command-line to view it."
            )}
          </p>
        )}
      </Fragment>
    );
  }

  observeSharedHeaders() {
    this.headerResizeObserver = new ResizeObserver(() => {
      if (this.headerMeasurementPending) return;
      this.headerMeasurementPending = true;
      lumine.views.updateDocument(() => {
        this.headerMeasurementPending = false;
        this.measureSharedHeaders();
      });
    });
    this.headerResizeObserver.observe(this.refs.editorArea);
    for (const record of this.sharedHeaders) this.headerResizeObserver.observe(record.element);
    // Native tiles attach and move block spacers during each editor paint. A
    // mutation callback runs before the browser paints, including the source
    // editor's final transform after a synchronized smooth-scroll frame.
    this.headerPaintObserver = new MutationObserver(() => this.synchronizeSharedHeaders());
    for (const side of SIDES) {
      const element = this.editors[side].get().getElement();
      this.headerPaintObserver.observe(element, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["style"],
      });
      this.subs.add(element.onDidAttach(() => this.measureSharedHeaders()));
    }
    this.measureSharedHeaders();
  }

  didUpdate() {
    this.measureSharedHeaders();
  }

  measureSharedHeaders() {
    if (this.destroyed) return;
    for (const record of this.sharedHeaders) {
      if (!record.element?.isConnected) continue;
      const height = record.element.getBoundingClientRect().height;
      if (record.height === height) continue;
      record.height = height;
      for (const side of SIDES) {
        if (record.spacers[side]) record.spacers[side].style.height = `${height}px`;
        // Native block ResizeObservers skip detached (virtualized) blocks.
        // Invalidate both sides explicitly so later files reserve the same
        // space before they enter the rendered tiles.
        const decoration = record.decorations[side]?.decorationHolder.getOr(null);
        if (decoration)
          this.editors[side]
            .get()
            .getElement()
            .getComponent()
            .invalidateBlockDecorationDimensions(decoration);
      }
    }
    this.restoreInitialScrollAnchor();
    this.synchronizeSharedHeaders();
  }

  synchronizeSharedHeaders(side = "old") {
    if (this.destroyed || !this.refs.sharedHeaders || !this.refs.editorArea.isConnected) return;
    const editorElement = this.editors[side].getOr(null)?.getElement();
    const beforeElement = this.editors.old.getOr(null)?.getElement();
    const afterElement = this.editors.new.getOr(null)?.getElement();
    if (!editorElement || !beforeElement || !afterElement) return;
    const areaRect = this.refs.editorArea.getBoundingClientRect();
    const renderedTiles = editorElement.getComponent().refs.lineTiles;
    const viewportHeight = editorElement.getHeight() - editorElement.getHorizontalScrollbarHeight();
    const layer = this.refs.sharedHeaders;
    layer.style.height = `${viewportHeight}px`;
    // Controls cover both native gutters as well as both text columns, while
    // remaining independent of either editor's horizontal scrolling.
    layer.style.left = `${beforeElement.getBoundingClientRect().left - areaRect.left}px`;
    layer.style.right = `${afterElement.getVerticalScrollbarWidth()}px`;
    for (const record of this.sharedHeaders) {
      const anchor = record.spacers[side];
      const header = record.element;
      if (!header) continue;
      const top =
        anchor?.isConnected && renderedTiles.contains(anchor)
          ? anchor.getBoundingClientRect().top - areaRect.top
          : Infinity;
      const visible = top < viewportHeight && top + record.height > 0;
      header.style.visibility = visible ? "visible" : "hidden";
      if (visible) header.style.transform = `translateY(${top}px)`;
    }
  }

  renderLineDecorations(side) {
    const runs = [];
    let previous = null;
    for (let row = 0; row < this.projection.rows.length; row++) {
      const entry = this.projection.rows[row];
      const patchRow = entry[`${side}Row`];
      const otherPatchRow = entry[side === "old" ? "newRow" : "oldRow"];
      const type = entry[`${side}Type`];
      const selected = patchRow !== null && this.props.selectedRows.has(patchRow);
      const classes = [
        type && type !== "unchanged" ? `git-panel-FilePatchView-line--${type}` : "",
        patchRow === null && otherPatchRow !== null
          ? "git-panel-SideBySidePatchView-placeholder"
          : "",
        selected ? "git-panel-FilePatchView-line--selected" : "",
      ]
        .filter(Boolean)
        .join(" ");
      if (!classes) {
        previous = null;
        continue;
      }
      if (previous?.classes === classes) previous.end = row;
      else {
        previous = { start: row, end: row, classes };
        runs.push(previous);
      }
    }
    return runs.map((run, index) => (
      <Marker
        editor={this.editors[side]}
        key={`line-${index}`}
        bufferRange={[
          [run.start, 0],
          [run.end, Infinity],
        ]}
        invalidate="never"
      >
        <Decoration type="line" className={run.classes} omitEmptyLastRow={false} />
        <Decoration
          type="line-number"
          className={run.classes}
          gutterName={`${side}-line-numbers`}
          omitEmptyLastRow={false}
        />
        {this.props.config.get("git-panel.showDiffIconGutter") && (
          <Decoration
            type="line-number"
            className={run.classes}
            gutterName="diff-icons"
            omitEmptyLastRow={false}
          />
        )}
      </Marker>
    ));
  }

  renderWordDecorations(side) {
    const layer =
      side === "old"
        ? this.props.multiFilePatch.getWordDeletionLayer()
        : this.props.multiFilePatch.getWordAdditionLayer();
    const className = `git-panel-FilePatchView-word--${side === "old" ? "deleted" : "added"}`;
    return layer.getMarkers().map((marker) => {
      const range = marker.getRange();
      const row = this.projection.patchRowToDisplayRow.get(range.start.row);
      if (row === undefined || this.projection.rows[row][`${side}Row`] !== range.start.row)
        return null;
      return (
        <Marker
          editor={this.editors[side]}
          key={`word-${marker.id}`}
          bufferRange={[
            [row, range.start.column],
            [row, range.end.column],
          ]}
          invalidate="never"
        >
          <Decoration type="highlight" className={className} />
        </Marker>
      );
    });
  }

  didChangeSelection(side, event) {
    if (this.suppressSelections || this.destroyed) return;
    if (event?.oldBufferRange?.isEqual(event.newBufferRange)) return;
    this.releaseInitialScrollAnchor();
    const editor = this.editors[side].getOr(null);
    if (!editor) return;
    this.activeSide = side;
    const ranges = [];
    for (const range of editor.getSelectedBufferRanges()) {
      for (const row of range.getRows()) {
        const patchRow = this.projection.rows[row]?.[`${side}Row`];
        if (patchRow === null || patchRow === undefined) continue;
        const start = row === range.start.row ? range.start.column : 0;
        const end = row === range.end.row ? range.end.column : Infinity;
        ranges.push(new Range([patchRow, start], [patchRow, end]));
      }
    }
    this.canonicalRanges = ranges;
    this.suppressSelections = true;
    try {
      const other = side === "old" ? "new" : "old";
      this.editors[other]
        .get()
        .setCursorBufferPosition(editor.getCursorBufferPosition(), { autoscroll: false });
    } finally {
      this.suppressSelections = false;
    }
    this.props.selectedRangesChanged("line");
  }

  getCanonicalSelectionRanges() {
    return this.canonicalRanges;
  }

  getCanonicalCursorPositions() {
    const side = this.activeSide;
    const positions = this.editors[side]
      .get()
      .getCursorBufferPositions()
      .flatMap((position) => {
        const row = this.projection.rows[position.row]?.[`${side}Row`];
        return row === null || row === undefined ? [] : [new Point(row, position.column)];
      });
    const selectedPositions = positions.filter((position) =>
      this.canonicalRanges.some((range) => range.intersectsRow(position.row)),
    );
    return selectedPositions.length
      ? selectedPositions
      : this.canonicalRanges.map((range) => range.end);
  }

  setCanonicalSelectionRanges(rangeLikes, { autoscroll = true, notify = true } = {}) {
    const previousSuppression = this.suppressSelections;
    this.suppressSelections = true;
    this.canonicalRanges = rangeLikes.map((range) =>
      this.props.multiFilePatch.getBuffer().clipRange(Range.fromObject(range)),
    );
    const mappedCounts = {};
    try {
      for (const side of SIDES) {
        const mapped = [];
        for (const range of this.canonicalRanges) {
          let run = null;
          for (const patchRow of range.getRows()) {
            const row = this.projection.patchRowToDisplayRow.get(patchRow);
            if (row === undefined || this.projection.rows[row][`${side}Row`] !== patchRow) continue;
            const start = patchRow === range.start.row ? range.start.column : 0;
            const end = patchRow === range.end.row ? range.end.column : Infinity;
            if (run && row === run.end.row + 1) run.end = new Point(row, end);
            else {
              run = new Range([row, start], [row, end]);
              mapped.push(run);
            }
          }
        }
        mappedCounts[side] = mapped.length;
        this.editors[side].get().setSelectedBufferRanges(
          mapped.length
            ? mapped
            : [
                [
                  [0, 0],
                  [0, 0],
                ],
              ],
          { autoscroll: false },
        );
      }
    } finally {
      this.suppressSelections = previousSuppression;
    }
    if (!mappedCounts[this.activeSide] && mappedCounts[this.activeSide === "old" ? "new" : "old"])
      this.activeSide = this.activeSide === "old" ? "new" : "old";
    if (autoscroll && this.canonicalRanges.length)
      this.revealPatchPosition(this.canonicalRanges.at(-1).start);
    if (notify) this.props.selectedRangesChanged();
  }

  handleSelectionEvent(event, rangeLike, { add = false } = {}) {
    const range = Range.fromObject(rangeLike);
    const ranges = this.canonicalRanges.slice();
    const multiple = event.metaKey || (event.ctrlKey && process.platform === "win32");
    if (multiple) {
      const remaining = [];
      let intersects = false;
      for (const existing of ranges) {
        if (!existing.intersectsWith(range)) {
          remaining.push(existing);
          continue;
        }
        intersects = true;
        if (existing.start.row < range.start.row)
          remaining.push(new Range(existing.start, [range.start.row - 1, Infinity]));
        if (existing.end.row > range.end.row)
          remaining.push(new Range([range.end.row + 1, 0], existing.end));
      }
      if (!intersects) remaining.push(range);
      if (remaining.length) this.setCanonicalSelectionRanges(remaining);
    } else if ((add || event.shiftKey) && ranges.length) {
      const last = ranges.pop();
      ranges.push(last.union(range));
      this.setCanonicalSelectionRanges(ranges);
    } else this.setCanonicalSelectionRanges([range]);
  }

  didMouseDownOnLineNumber(side, event) {
    const row = this.projection.rows[event.bufferRow]?.[`${side}Row`];
    if (
      row === null ||
      row === undefined ||
      event.domEvent.button !== 0 ||
      (event.domEvent.ctrlKey && process.platform !== "win32")
    )
      return;
    this.activeSide = side;
    this.draggingSide = side;
    this.handleDisplaySelectionEvent(side, event.domEvent, event.bufferRow);
    this.editors[side].get().getElement().focus();
    event.domEvent.preventDefault();
  }

  didMouseMoveOnLineNumber(side, event) {
    if (event.domEvent.buttons !== 1 || this.draggingSide !== side) return;
    const row = this.projection.rows[event.bufferRow]?.[`${side}Row`];
    if (row === null || row === undefined) return;
    this.handleDisplaySelectionEvent(side, event.domEvent, event.bufferRow, true);
  }

  handleDisplaySelectionEvent(side, event, row, extend = false) {
    const editor = this.editors[side].get();
    const range = editor.clipBufferRange(new Range([row, 0], [row, Infinity]));
    const ranges = editor.getSelectedBufferRanges();
    if (event.metaKey || (event.ctrlKey && process.platform === "win32")) {
      let intersects = false;
      const remaining = [];
      for (const existing of ranges) {
        if (!existing.intersectsWith(range)) {
          remaining.push(existing);
          continue;
        }
        intersects = true;
        if (existing.start.row < row)
          remaining.push(new Range(existing.start, [row - 1, Infinity]));
        if (existing.end.row > row) remaining.push(new Range([row + 1, 0], existing.end));
      }
      if (!intersects) remaining.push(range);
      if (remaining.length) editor.setSelectedBufferRanges(remaining, { autoscroll: false });
    } else if (extend || event.shiftKey) {
      const last = ranges.pop();
      editor.setSelectedBufferRanges([...ranges, last.union(range)], { autoscroll: false });
    } else editor.setSelectedBufferRange(range, { autoscroll: false });
  }

  revealPatchPosition(position) {
    const row = this.projection.patchRowToDisplayRow.get(position.row);
    if (row === undefined) return;
    this.editors[this.activeSide]
      .get()
      .scrollToBufferPosition([row, position.column], { center: true });
  }

  goToPatchPosition(position) {
    this.setCanonicalSelectionRanges([new Range(position, position)], { autoscroll: false });
    this.revealPatchPosition(position);
  }

  focus() {
    if (!this.destroyed) this.editors[this.activeSide].get().getElement().focus();
  }

  willDestroy() {
    this.initialScrollAnchor = null;
    this.wrapAlignment?.dispose();
    this.headerResizeObserver?.disconnect();
    this.headerPaintObserver?.disconnect();
    this.subs.dispose();
    for (const side of SIDES) if (!this.buffers[side].isDestroyed()) this.buffers[side].destroy();
  }
}
