/** @babel */
/** @jsx h */
import { CompositeDisposable, Disposable, Range, Point, TextBuffer } from "lumine";
import { View, h, Fragment } from "../etch/view";
import RefHolder from "../models/ref-holder";
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
    this.subs = new CompositeDisposable();
    this.suppressSelections = true;
    this.activeSide = "new";
    this.canonicalRanges = (props.initialRanges || []).map((range) => Range.fromObject(range));
    this.initialize();
  }

  didMount() {
    for (const side of SIDES) {
      const editor = this.editors[side].get();
      const element = editor.getElement();
      const focus = () => {
        this.activeSide = side;
      };
      element.addEventListener("focusin", focus);
      this.subs.add(
        new Disposable(() => element.removeEventListener("focusin", focus)),
        element.onDidChangeScrollTop(() => this.synchronizeScroll(side, "Top")),
        element.onDidChangeScrollLeft(() => this.synchronizeScroll(side, "Left")),
      );
      if (side === "old") this.subs.add(lumine.textEditors.add(editor, { role: "viewer" }));
    }
    this.props.refEditor.setter(this.editors.new.get());
    this.setCanonicalSelectionRanges(this.canonicalRanges, { autoscroll: false, notify: false });
    this.editors.new
      .get()
      .getElement()
      .setScrollTop(this.props.initialScrollTop || 0);
    this.suppressSelections = false;
  }

  synchronizeScroll(side, axis) {
    if (this.synchronizingScroll || this.destroyed) return;
    const other = side === "old" ? "new" : "old";
    this.synchronizingScroll = true;
    try {
      const source = this.editors[side].get().getElement();
      this.editors[other].get().getElement()[`setScroll${axis}`](source[`getScroll${axis}`]());
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
    const { index, viewport } = this.pendingPatchUpdate || this.prepareForPatchUpdate();
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
      const ranges =
        props.selectionMode === "hunk" && hunks.size
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
    const index = this.props.multiFilePatch.getMaxSelectionIndex(this.props.selectedRows);
    const viewport = SIDES.map((side) => {
      const element = this.editors[side].get().getElement();
      return [element.getScrollTop(), element.getScrollLeft()];
    });
    this.pendingPatchUpdate = { index, viewport };
    return this.pendingPatchUpdate;
  }

  render() {
    return (
      <div className="git-panel-SideBySidePatchView">
        <div className="git-panel-SideBySidePatchView-toolbar">
          <span className="git-panel-SideBySidePatchView-sideLabel">Before</span>
          <span className="git-panel-SideBySidePatchView-sideLabel">After</span>
        </div>
        <div className="git-panel-SideBySidePatchView-editors">
          {SIDES.map((side) => this.renderSide(side))}
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
          softWrapped={false}
          maxScreenLineLength={Infinity}
          lineNumberGutterVisible={false}
          autoHeight={false}
          autoWidth={false}
          scrollPastEnd={false}
          didAddSelection={() => this.didChangeSelection(side)}
          didChangeSelectionRange={() => this.didChangeSelection(side)}
          didDestroySelection={() => this.didChangeSelection(side)}
        >
          <Gutter
            editor={ref}
            name={`${side}-line-numbers`}
            className={side}
            priority={1}
            type="line-number"
            labelFn={({ bufferRow }) =>
              String(this.projection.rows[bufferRow]?.[`${side}LineNumber`] ?? "")
            }
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
              labelFn={() => ""}
              onMouseDown={(event) => this.didMouseDownOnLineNumber(side, event)}
              onMouseMove={(event) => this.didMouseMoveOnLineNumber(side, event)}
            />
          )}
          {Array.from(this.projection.fileRanges, ([patch, range], index) => (
            <Marker
              editor={ref}
              key={`file-${index}`}
              bufferRange={[
                [range[0], 0],
                [range[0], 0],
              ]}
              invalidate="never"
            >
              <Decoration
                editor={ref}
                type="block"
                position="before"
                order={0}
                className={`git-panel-FilePatchView-controlBlock${side === "new" ? " git-panel-SideBySidePatchView-mirrorHeader" : ""}`}
              >
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
              </Decoration>
            </Marker>
          ))}
          {Array.from(this.projection.hunkRanges, ([hunk, range], index) => (
            <Marker
              editor={ref}
              key={`hunk-${index}`}
              bufferRange={[
                [range[0], 0],
                [range[0], 0],
              ]}
              invalidate="never"
            >
              <Decoration
                editor={ref}
                type="block"
                position="before"
                order={0.2}
                className={`git-panel-FilePatchView-controlBlock${side === "new" ? " git-panel-SideBySidePatchView-mirrorHeader" : ""}`}
              >
                {this.props.renderHunkHeader(hunk)}
              </Decoration>
            </Marker>
          ))}
          {this.renderLineDecorations(side)}
          {this.renderWordDecorations(side)}
        </LumineTextEditor>
      </div>
    );
  }

  renderLineDecorations(side) {
    const runs = [];
    let previous = null;
    for (let row = 0; row < this.projection.rows.length; row++) {
      const entry = this.projection.rows[row];
      const patchRow = entry[`${side}Row`];
      const type = entry[`${side}Type`];
      const selected = patchRow !== null && this.props.selectedRows.has(patchRow);
      const classes = [
        type && type !== "unchanged" ? `git-panel-FilePatchView-line--${type}` : "",
        patchRow === null ? "git-panel-SideBySidePatchView-placeholder" : "",
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

  didChangeSelection(side) {
    if (this.suppressSelections || this.destroyed) return;
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
    this.subs.dispose();
    for (const side of SIDES) if (!this.buffers[side].isDestroyed()) this.buffers[side].destroy();
  }
}
