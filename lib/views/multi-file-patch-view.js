/** @babel */
/** @jsx h */
import { View, h, Fragment } from "../etch/view";
import cx from "classnames";
import { Range } from "lumine";
import { CompositeDisposable, Disposable } from "lumine";

import { autobind, NBSP_CHARACTER, blankLabel } from "../helpers";

import LumineTextEditor from "../lumine/lumine-text-editor";
import Marker from "../lumine/marker";
import MarkerLayer from "../lumine/marker-layer";
import Decoration from "../lumine/decoration";
import Gutter from "../lumine/gutter";
import Commands, { Command } from "../lumine/commands";
import FilePatchHeaderView from "./file-patch-header-view";
import FilePatchMetaView from "./file-patch-meta-view";
import HunkHeaderView from "./hunk-header-view";
import RefHolder from "../models/ref-holder";
import ChangedFileItem from "../items/changed-file-item";
import CommitDetailItem from "../items/commit-detail-item";
import File from "../models/patch/file";
import SideBySidePatchView from "./side-by-side-patch-view";
import FullWidthBlockDecoration, { FullWidthBlockOverlay } from "./full-width-block-decoration";

const executableText = {
  [File.modes.NORMAL]: "non executable",
  [File.modes.EXECUTABLE]: "executable",
};

export default class MultiFilePatchView extends View {
  static defaultProps = {
    onWillUpdatePatch: () => new Disposable(),
    onDidUpdatePatch: () => new Disposable(),
    reviewCommentsLoading: false,
    reviewCommentThreads: [],
  };

  constructor(props, children) {
    super(props, children);
    autobind(
      this,
      "didMouseDownOnHeader",
      "didMouseDownOnLineNumber",
      "didMouseMoveOnLineNumber",
      "didMouseUp",
      "didConfirm",
      "didToggleSelectionMode",
      "selectNextHunk",
      "selectPreviousHunk",
      "didOpenFile",
      "didAddSelection",
      "didChangeSelectionRange",
      "didDestroySelection",
      "oldLineNumberLabel",
      "newLineNumberLabel",
    );

    this.mouseSelectionInProgress = false;
    this.lastMouseMoveLine = null;
    this.nextSelectionMode = null;
    this.refRoot = new RefHolder();
    this.refEditor = new RefHolder();
    this.refEditorElement = new RefHolder();
    this.refSideBySide = new RefHolder();
    this.refFullWidthHeaders = new RefHolder();
    this.fullWidthHeaders = new FullWidthBlockOverlay(this.refEditor, this.refFullWidthHeaders);
    this.state.diffView =
      this.props.initialDiffView === "side-by-side" ? "side-by-side" : "unified";
    this.mounted = false;

    this.subs = new CompositeDisposable();
    this.patchLease = this.props.multiFilePatch.retain?.();

    this.subs.add(
      this.refEditor.observe((editor) => {
        this.refEditorElement.setter(editor.getElement());
        if (this.props.refEditor) {
          this.props.refEditor.setter(editor);
        }
      }),
      this.refEditorElement.observe((element) => {
        this.props.refInitialFocus && this.props.refInitialFocus.setter(element);
      }),
    );

    // Synchronously maintain the editor's scroll position and logical selection across buffer updates.
    this.suppressChanges = false;
    this.pendingSelectionPatch = null;
    let lastScrollTop = null;
    let lastScrollLeft = null;
    let lastSelectionIndex = null;
    this.subs.add(
      this.props.onWillUpdatePatch(() => {
        this.suppressChanges = true;
        if (this.state.diffView === "side-by-side") {
          this.refSideBySide.map((view) => view.prepareForPatchUpdate());
          return;
        }
        this.refEditor.map((editor) => {
          lastSelectionIndex = this.props.multiFilePatch.getMaxSelectionIndex(
            this.props.selectedRows,
          );
          lastScrollTop = editor.getElement().getScrollTop();
          lastScrollLeft = editor.getElement().getScrollLeft();
          this.layoutViewportPreferences ||= {};
          this.layoutViewportPreferences.unified = {
            ...this.layoutViewportPreferences.unified,
            softWrapped: editor.isSoftWrapped(),
          };
          return null;
        });
      }),
      this.props.onDidUpdatePatch((nextPatch) => {
        if (this.state.diffView === "side-by-side") {
          this.suppressChanges = false;
          this.pendingSelectionPatch = nextPatch;
          return;
        }
        const preserveViewport = !nextPatch.getBuffer().isEmpty();
        this.refEditor.map((editor) => {
          /* istanbul ignore else */
          if (lastSelectionIndex !== null) {
            const nextSelectionRange = nextPatch.getSelectionRangeForIndex(lastSelectionIndex);
            if (this.props.selectionMode === "line") {
              this.nextSelectionMode = "line";
              editor.setSelectedBufferRange(nextSelectionRange, { autoscroll: false });
            } else {
              const nextHunks = new Set(
                Range.fromObject(nextSelectionRange)
                  .getRows()
                  .map((row) => nextPatch.getHunkAt(row))
                  .filter(Boolean),
              );
              /* istanbul ignore next */
              const nextRanges =
                nextHunks.size > 0
                  ? Array.from(nextHunks, (hunk) => hunk.getRange())
                  : [
                      [
                        [0, 0],
                        [0, 0],
                      ],
                    ];

              this.nextSelectionMode = "hunk";
              editor.setSelectedBufferRanges(nextRanges, { autoscroll: false });
            }
          }

          /* istanbul ignore else */
          if (lastScrollTop !== null) {
            editor.getElement().setScrollTop(preserveViewport ? lastScrollTop : 0);
          }

          /* istanbul ignore else */
          if (lastScrollLeft !== null) {
            editor.getElement().setScrollLeft(preserveViewport ? lastScrollLeft : 0);
          }
          return null;
        });
        this.pendingViewport = {
          patch: nextPatch,
          top: preserveViewport ? lastScrollTop : 0,
          left: preserveViewport ? lastScrollLeft : 0,
        };
        this.suppressChanges = false;
        // Publishing selected rows renders the controller. Wait until the view has received the
        // matching MultiFilePatch so it cannot render old hunk decorations over the new buffer.
        this.pendingSelectionPatch = nextPatch;
      }),
    );

    this.initialize();
  }

  didMount() {
    this.mounted = true;
    this.measurePerformance("mount");

    window.addEventListener("mouseup", this.didMouseUp);
    this.refEditor.map((editor) => {
      if (this.state.diffView === "side-by-side") return null;
      // this.props.multiFilePatch is guaranteed to contain at least one FilePatch if <LumineTextEditor> is rendered.
      const [firstPatch] = this.props.multiFilePatch.getFilePatches();
      const [firstHunk] = firstPatch.getHunks();
      if (!firstHunk) {
        return null;
      }

      this.nextSelectionMode = "hunk";
      editor.setSelectedBufferRange(firstHunk.getRange());
      return null;
    });

    this.subs.add(
      this.props.config.onDidChange("git-panel.showDiffIconGutter", () => this.invalidate()),
    );

    const { initChangedFilePath, initChangedFilePosition } = this.props;

    /* istanbul ignore next */
    if (initChangedFilePath && initChangedFilePosition >= 0) {
      this.scrollToFile({
        changedFilePath: initChangedFilePath,
        changedFilePosition: initChangedFilePosition,
      });
    }

    /* istanbul ignore if */
    if (this.props.onOpenFilesTab) {
      this.subs.add(this.props.onOpenFilesTab(this.scrollToFile));
    }
  }

  update(props, children) {
    if (this.destroyed) return Promise.resolve();
    if (props.multiFilePatch === this.props.multiFilePatch) return super.update(props, children);
    const lease = props.multiFilePatch?.retain?.();
    const previousLease = this.patchLease;
    this.patchLease = lease;
    try {
      return Promise.resolve(super.update(props, children)).finally(() => previousLease?.dispose());
    } catch (error) {
      previousLease?.dispose();
      throw error;
    }
  }

  didUpdate(prevProps) {
    this.measurePerformance("update");

    if (prevProps.refInitialFocus !== this.props.refInitialFocus) {
      prevProps.refInitialFocus && prevProps.refInitialFocus.setter(null);
      this.props.refInitialFocus && this.refEditorElement.map(this.props.refInitialFocus.setter);
    }

    if (this.pendingSelectionPatch) {
      if (this.props.multiFilePatch === this.pendingSelectionPatch) {
        this.pendingSelectionPatch = null;
        if (this.pendingViewport?.patch === this.props.multiFilePatch) {
          const { top, left } = this.pendingViewport;
          this.pendingViewport = null;
          if (top !== null) this.fullWidthHeaders.preserveViewport(top, left);
        }
        this.didChangeSelectedRows();
        this.nextSelectionMode = null;
      }
    } else if (this.props.multiFilePatch === prevProps.multiFilePatch) {
      this.nextSelectionMode = null;
    }
  }

  willDestroy() {
    this.fullWidthHeaders.dispose();
    window.removeEventListener("mouseup", this.didMouseUp);
    this.subs.dispose();
    this.patchLease?.dispose();
    this.patchLease = null;
    this.mounted = false;
    performance.clearMarks();
    performance.clearMeasures();
  }

  render() {
    const rootClass = cx(
      "git-panel-FilePatchView",
      { [`git-panel-FilePatchView--${this.props.stagingStatus}`]: this.props.stagingStatus },
      { "git-panel-FilePatchView--blank": !this.props.multiFilePatch.anyPresent() },
      { "git-panel-FilePatchView--hunkMode": this.props.selectionMode === "hunk" },
    );
    const lineNumberDigits = Math.max(2, this.props.multiFilePatch.getMaxLineNumberWidth());
    const rootStyle = {
      "--git-panel-line-number-content-width": `${lineNumberDigits}ch`,
    };

    if (this.mounted) {
      performance.mark("MultiFilePatchView-update-start");
    } else {
      performance.mark("MultiFilePatchView-mount-start");
    }

    return (
      <div className={rootClass} style={rootStyle} ref={this.refRoot.setter}>
        {this.renderCommands()}
        {this.props.multiFilePatch.getWordDiffStats?.()?.omittedPairs > 0 && (
          <div
            className="text-subtle git-panel-FilePatchView-wordDiffNotice"
            title="Detailed word highlighting is limited for long or expensive lines. The complete line diff and staging remain available."
          >
            Some changes are highlighted by line to keep the diff responsive.
          </div>
        )}

        <main className="git-panel-FilePatchView-container">
          {this.props.multiFilePatch.anyPresent()
            ? this.renderNonEmptyPatch()
            : this.renderEmptyPatch()}
          <div
            ref={this.refFullWidthHeaders.setter}
            className="git-panel-FullWidthBlockOverlay"
            hidden={this.state.diffView !== "unified"}
          />
        </main>
      </div>
    );
  }

  renderCommands() {
    if (this.props.readOnly || this.props.itemType === CommitDetailItem) {
      return (
        <Commands registry={this.props.commands} target={this.refRoot}>
          <Command
            command="git-panel:select-next-hunk"
            description="Move the selection to the next hunk of the diff."
            callback={this.selectNextHunk}
          />
          <Command
            command="git-panel:select-previous-hunk"
            description="Move the selection to the previous hunk of the diff."
            callback={this.selectPreviousHunk}
          />
          <Command
            command="git-panel:toggle-patch-selection-mode"
            description="Select by hunk instead of by line, or back again."
            description="Select by hunk instead of by line, or back again."
            callback={this.didToggleSelectionMode}
          />
        </Commands>
      );
    }

    let stageModeCommand = null;
    let stageSymlinkCommand = null;

    // Both pairs are written out rather than picked with a ternary on the name
    // alone: the description belongs beside the name it explains, and a name
    // built from a variable is one neither a reader nor the command check can
    // find.
    if (this.props.multiFilePatch.didAnyChangeExecutableMode()) {
      stageModeCommand =
        this.props.stagingStatus === "unstaged" ? (
          <Command
            command="git-panel:stage-file-mode-change"
            description="Stage the change to the file's permission bits alone."
            callback={this.didToggleModeChange}
          />
        ) : (
          <Command
            command="git-panel:unstage-file-mode-change"
            description="Unstage the change to the file's permission bits alone."
            callback={this.didToggleModeChange}
          />
        );
    }

    if (this.props.multiFilePatch.anyHaveTypechange()) {
      stageSymlinkCommand =
        this.props.stagingStatus === "unstaged" ? (
          <Command
            command="git-panel:stage-symlink-change"
            description="Stage the change between a symlink and a real file."
            callback={this.didToggleSymlinkChange}
          />
        ) : (
          <Command
            command="git-panel:unstage-symlink-change"
            description="Unstage the change between a symlink and a real file."
            callback={this.didToggleSymlinkChange}
          />
        );
    }

    return (
      <Commands registry={this.props.commands} target={this.refRoot}>
        <Command
          command="git-panel:select-next-hunk"
          description="Move the selection to the next hunk of the diff."
          callback={this.selectNextHunk}
        />
        <Command
          command="git-panel:select-previous-hunk"
          description="Move the selection to the previous hunk of the diff."
          callback={this.selectPreviousHunk}
        />
        <Command command="core:confirm" callback={this.didConfirm} />
        <Command command="core:undo" callback={this.undoLastDiscardFromCoreUndo} />
        <Command
          command="git-panel:discard-selected-lines"
          description="Throw away just the lines selected in this diff."
          description="Throw away just the lines selected in this diff."
          callback={this.discardSelectionFromCommand}
        />
        <Command
          command="git-panel:jump-to-file"
          description="Open the real file at the line the diff is showing."
          callback={this.didOpenFile}
        />
        <Command
          command="git-panel:surface"
          description="Go back out to the list this view was opened from."
          callback={this.props.surface}
        />
        <Command
          command="git-panel:toggle-patch-selection-mode"
          description="Select by hunk instead of by line, or back again."
          description="Select by hunk instead of by line, or back again."
          callback={this.didToggleSelectionMode}
        />
        {stageModeCommand}
        {stageSymlinkCommand}
        {
          /* istanbul ignore next */ lumine.window.isDevMode() && (
            <Command
              command="git-panel:inspect-patch"
              callback={() => {
                console.log(
                  this.props.multiFilePatch.getPatchBuffer().inspect({
                    layerNames: ["patch", "hunk"],
                  }),
                );
              }}
            />
          )
        }
        {
          /* istanbul ignore next */ lumine.window.isDevMode() && (
            <Command
              command="git-panel:inspect-regions"
              callback={() => {
                console.log(
                  this.props.multiFilePatch.getPatchBuffer().inspect({
                    layerNames: ["unchanged", "deletion", "addition", "nonewline"],
                  }),
                );
              }}
            />
          )
        }
        {
          /* istanbul ignore next */ lumine.window.isDevMode() && (
            <Command
              command="git-panel:inspect-mfp"
              callback={() => {
                console.log(this.props.multiFilePatch.inspect());
              }}
            />
          )
        }
      </Commands>
    );
  }

  renderEmptyPatch() {
    return <p className="git-panel-FilePatchView-message icon icon-info">No changes to display</p>;
  }

  renderNonEmptyPatch() {
    if (this.state.diffView === "side-by-side") {
      return (
        <SideBySidePatchView
          key="patch-editor"
          ref={this.refSideBySide.setter}
          {...this.props}
          refEditor={this.refEditor}
          initialRanges={this.layoutSelectionRanges}
          initialScrollAnchor={this.layoutScrollAnchor}
          initialScrollLeftColumn={this.layoutViewportPreferences?.["side-by-side"]?.leftColumn}
          initialSoftWrapped={this.layoutViewportPreferences?.["side-by-side"]?.softWrapped ?? true}
          renderFileHeader={this.renderFileHeader}
          renderHunkHeader={this.renderHunkHeader}
          renderSymlinkChangeMeta={(patch) => this.renderSymlinkChangeMeta(patch)}
          renderExecutableModeChangeMeta={(patch) => this.renderExecutableModeChangeMeta(patch)}
          expandFilePatch={(patch) => this.changePatchRenderStatus(patch, true)}
          selectedRangesChanged={(mode) => {
            if (mode) this.nextSelectionMode = mode;
            this.didChangeSelectedRows();
          }}
        />
      );
    }
    return (
      <LumineTextEditor
        key="patch-editor"
        workspace={this.props.workspace}
        buffer={this.props.multiFilePatch.getBuffer()}
        lineNumberGutterVisible={false}
        autoWidth={false}
        autoHeight={false}
        readOnly={true}
        softWrapped={this.layoutViewportPreferences?.unified?.softWrapped ?? true}
        didAddSelection={this.didAddSelection}
        didChangeSelectionRange={this.didChangeSelectionRange}
        didDestroySelection={this.didDestroySelection}
        refModel={this.refEditor}
        hideEmptiness={true}
      >
        <Gutter
          editor={this.refEditor}
          name="old-line-numbers"
          priority={1}
          className="old"
          type="line-number"
          labelFn={this.oldLineNumberLabel}
          onMouseDown={this.didMouseDownOnLineNumber}
          onMouseMove={this.didMouseMoveOnLineNumber}
        />
        <Gutter
          editor={this.refEditor}
          name="new-line-numbers"
          priority={2}
          className="new"
          type="line-number"
          labelFn={this.newLineNumberLabel}
          onMouseDown={this.didMouseDownOnLineNumber}
          onMouseMove={this.didMouseMoveOnLineNumber}
        />
        <Gutter
          editor={this.refEditor}
          name="git-panel-comment-icon"
          priority={3}
          className="comment"
          type="decorated"
          hideWhenEmpty={true}
        />
        {this.props.config.get("git-panel.showDiffIconGutter") && (
          <Gutter
            editor={this.refEditor}
            name="diff-icons"
            priority={4}
            type="line-number"
            className="icons"
            labelFn={blankLabel}
            onMouseDown={this.didMouseDownOnLineNumber}
            onMouseMove={this.didMouseMoveOnLineNumber}
          />
        )}

        {this.props.multiFilePatch.getFilePatches().map(this.renderFilePatchDecorations)}

        {this.renderLineDecorations(
          Array.from(this.props.selectedRows, (row) =>
            Range.fromObject([
              [row, 0],
              [row, Infinity],
            ]),
          ),
          "git-panel-FilePatchView-line--selected",
          { gutter: true, icon: true, line: true },
        )}

        {this.renderDecorationsOnLayer(
          this.props.multiFilePatch.getAdditionLayer(),
          "git-panel-FilePatchView-line--added",
          { gutter: true, icon: true, line: true },
        )}
        {this.renderDecorationsOnLayer(
          this.props.multiFilePatch.getDeletionLayer(),
          "git-panel-FilePatchView-line--deleted",
          { gutter: true, icon: true, line: true },
        )}
        {this.renderDecorationsOnLayer(
          this.props.multiFilePatch.getNoNewlineLayer(),
          "git-panel-FilePatchView-line--nonewline",
          { gutter: true, icon: true, line: true },
        )}

        {this.renderWordDiffDecorations()}
      </LumineTextEditor>
    );
  }

  renderFilePatchDecorations = (filePatch, index) => {
    if (this.props.compact) return null;
    const isCollapsed = !filePatch.getRenderStatus().isVisible();
    const isEmpty = filePatch.getMarker().getRange().isEmpty();
    const isExpandable = filePatch.getRenderStatus().isExpandable();
    const isUnavailable = isCollapsed && !isExpandable;
    const atEnd = filePatch
      .getStartRange()
      .start.isEqual(this.props.multiFilePatch.getBuffer().getEndPosition());
    const position = isEmpty && atEnd ? "after" : "before";

    return (
      <Fragment key={filePatch.getPath()}>
        <Marker editor={this.refEditor} invalidate="never" bufferRange={filePatch.getStartRange()}>
          <FullWidthBlockDecoration
            editor={this.refEditor}
            portal={this.fullWidthHeaders}
            type="block"
            position={position}
            order={index}
            className="git-panel-FilePatchView-controlBlock"
          >
            {this.renderFileHeader(filePatch)}
            {!isCollapsed && this.renderSymlinkChangeMeta(filePatch)}
            {!isCollapsed && this.renderExecutableModeChangeMeta(filePatch)}
          </FullWidthBlockDecoration>
        </Marker>

        {isExpandable && this.renderDiffGate(filePatch, position, index)}
        {isUnavailable && this.renderDiffUnavailable(filePatch, position, index)}

        {this.renderHunkHeaders(filePatch, index)}
      </Fragment>
    );
  };

  renderFileHeader = (filePatch) => (
    <FilePatchHeaderView
      itemType={this.props.itemType}
      readOnly={this.props.readOnly}
      relPath={filePatch.getPath()}
      newPath={filePatch.getStatus() === "renamed" ? filePatch.getNewPath() : null}
      stagingStatus={this.props.stagingStatus}
      isPartiallyStaged={this.props.isPartiallyStaged}
      hasUndoHistory={this.props.hasUndoHistory}
      hasMultipleFileSelections={this.props.hasMultipleFileSelections}
      tooltips={this.props.tooltips}
      undoLastDiscard={() => this.undoLastDiscardFromButton(filePatch)}
      diveIntoMirrorPatch={() => this.props.diveIntoMirrorPatch(filePatch)}
      openFile={() => this.didOpenFile({ selectedFilePatch: filePatch })}
      toggleFile={() => this.props.toggleFile(filePatch)}
      isCollapsed={!filePatch.getRenderStatus().isVisible()}
      triggerCollapse={() => this.changePatchRenderStatus(filePatch, false)}
      triggerExpand={() => this.changePatchRenderStatus(filePatch, true)}
    />
  );

  changePatchRenderStatus(filePatch, expanded) {
    if (expanded === filePatch.getRenderStatus().isVisible()) return Promise.resolve();
    if (this.state.diffView === "side-by-side")
      this.refSideBySide.map((view) => view.prepareForPatchUpdate());
    if (expanded) this.props.multiFilePatch.expandFilePatch(filePatch);
    else this.props.multiFilePatch.collapseFilePatch(filePatch);
    return this.invalidate();
  }

  didChangeDiffView = async (diffView) => {
    if (diffView === this.state.diffView || this.destroyed) return;
    const generation = (this.diffViewGeneration || 0) + 1;
    this.diffViewGeneration = generation;
    const pair = this.refSideBySide.getOr(null);
    const editor = pair ? pair.editors[pair.activeSide].getOr(null) : this.refEditor.getOr(null);
    const focused = this.element.contains(document.activeElement);
    const selectionRanges = pair
      ? pair.getCanonicalSelectionRanges()
      : editor?.getSelectedBufferRanges() || [];
    let scrollAnchor = pair
      ? pair.captureCanonicalScrollAnchor()
      : editor?.getElement().getComponent().captureScrollAnchor({ anchorTop: true });
    if (pair) this.layoutActiveSide = pair.activeSide;
    if (scrollAnchor?.type === "row")
      scrollAnchor = {
        ...scrollAnchor,
        side: scrollAnchor.side || this.layoutActiveSide,
      };
    this.layoutSelectionRanges = selectionRanges;
    this.layoutScrollAnchor = scrollAnchor;
    if (editor) {
      const component = editor.getElement().getComponent();
      this.layoutViewportPreferences ||= {};
      // State changes before Etch replaces the native editor. A rapid next
      // toggle still captures from the renderer that is actually mounted.
      this.layoutViewportPreferences[pair ? "side-by-side" : "unified"] = {
        softWrapped: editor.isSoftWrapped(),
        leftColumn: component.getScrollLeft() / component.getBaseCharacterWidth(),
      };
    }
    this.suppressChanges = true;
    await this.updateState({ diffView });
    if (
      this.destroyed ||
      generation !== this.diffViewGeneration ||
      this.state.diffView !== diffView
    )
      return;
    if (diffView === "unified") {
      this.refEditor.map((nextEditor) => {
        nextEditor.setSelectedBufferRanges(
          selectionRanges.length
            ? selectionRanges
            : [
                [
                  [0, 0],
                  [0, 0],
                ],
              ],
          { autoscroll: false },
        );
        const component = nextEditor.getElement().getComponent();
        component.setScrollAnchor(scrollAnchor);
        component.setScrollLeftColumn(this.layoutViewportPreferences?.unified?.leftColumn || 0);
      });
    }
    this.suppressChanges = false;
    if (focused) {
      if (diffView === "side-by-side") this.refSideBySide.map((view) => view.focus());
      else this.refEditor.map((nextEditor) => nextEditor.getElement().focus());
    }
  };

  renderDiffGate(filePatch, position, orderOffset) {
    const showDiff = () => {
      this.changePatchRenderStatus(filePatch, true);
    };
    return (
      <Marker editor={this.refEditor} invalidate="never" bufferRange={filePatch.getStartRange()}>
        <FullWidthBlockDecoration
          editor={this.refEditor}
          portal={this.fullWidthHeaders}
          type="block"
          order={orderOffset + 0.1}
          position={position}
          className="git-panel-FilePatchView-controlBlock"
        >
          <p className="git-panel-FilePatchView-message icon icon-info">
            Large diffs are collapsed by default for performance reasons.
            <br />
            <button className="git-panel-FilePatchView-showDiffButton" onClick={showDiff}>
              {" "}
              Load Diff
            </button>
          </p>
        </FullWidthBlockDecoration>
      </Marker>
    );
  }

  renderDiffUnavailable(filePatch, position, orderOffset) {
    return (
      <Marker editor={this.refEditor} invalidate="never" bufferRange={filePatch.getStartRange()}>
        <FullWidthBlockDecoration
          editor={this.refEditor}
          portal={this.fullWidthHeaders}
          type="block"
          order={orderOffset + 0.1}
          position={position}
          className="git-panel-FilePatchView-controlBlock"
        >
          <p className="git-panel-FilePatchView-message icon icon-warning">
            This diff is too large to load at all. Use the command-line to view it.
          </p>
        </FullWidthBlockDecoration>
      </Marker>
    );
  }

  renderExecutableModeChangeMeta(filePatch) {
    if (!filePatch.didChangeExecutableMode()) {
      return null;
    }

    const oldMode = filePatch.getOldMode();
    const newMode = filePatch.getNewMode();

    const attrs =
      this.props.stagingStatus === "unstaged"
        ? {
            actionIcon: "icon-move-down",
            actionText: "Stage Mode Change",
          }
        : {
            actionIcon: "icon-move-up",
            actionText: "Unstage Mode Change",
          };

    return (
      <FilePatchMetaView
        title="Mode change"
        actionIcon={attrs.actionIcon}
        actionText={attrs.actionText}
        itemType={this.props.itemType}
        readOnly={this.props.readOnly}
        action={() => this.props.toggleModeChange(filePatch)}
      >
        <Fragment>
          File changed mode
          <span className="git-panel-FilePatchView-metaDiff git-panel-FilePatchView-metaDiff--removed">
            from {executableText[oldMode]} <code>{oldMode}</code>
          </span>
          <span className="git-panel-FilePatchView-metaDiff git-panel-FilePatchView-metaDiff--added">
            to {executableText[newMode]} <code>{newMode}</code>
          </span>
        </Fragment>
      </FilePatchMetaView>
    );
  }

  renderSymlinkChangeMeta(filePatch) {
    if (!filePatch.hasSymlink()) {
      return null;
    }

    let detail;
    let title;
    const oldSymlink = filePatch.getOldSymlink();
    const newSymlink = filePatch.getNewSymlink();
    if (oldSymlink && newSymlink) {
      detail = (
        <Fragment>
          Symlink changed
          <span
            className={cx(
              "git-panel-FilePatchView-metaDiff",
              "git-panel-FilePatchView-metaDiff--fullWidth",
              "git-panel-FilePatchView-metaDiff--removed",
            )}
          >
            from <code>{oldSymlink}</code>
          </span>
          <span
            className={cx(
              "git-panel-FilePatchView-metaDiff",
              "git-panel-FilePatchView-metaDiff--fullWidth",
              "git-panel-FilePatchView-metaDiff--added",
            )}
          >
            to <code>{newSymlink}</code>
          </span>
          .
        </Fragment>
      );
      title = "Symlink changed";
    } else if (oldSymlink && !newSymlink) {
      detail = (
        <Fragment>
          Symlink
          <span className="git-panel-FilePatchView-metaDiff git-panel-FilePatchView-metaDiff--removed">
            to <code>{oldSymlink}</code>
          </span>
          deleted.
        </Fragment>
      );
      title = "Symlink deleted";
    } else {
      detail = (
        <Fragment>
          Symlink
          <span className="git-panel-FilePatchView-metaDiff git-panel-FilePatchView-metaDiff--added">
            to <code>{newSymlink}</code>
          </span>
          created.
        </Fragment>
      );
      title = "Symlink created";
    }

    const attrs =
      this.props.stagingStatus === "unstaged"
        ? {
            actionIcon: "icon-move-down",
            actionText: "Stage Symlink Change",
          }
        : {
            actionIcon: "icon-move-up",
            actionText: "Unstage Symlink Change",
          };

    return (
      <FilePatchMetaView
        title={title}
        actionIcon={attrs.actionIcon}
        actionText={attrs.actionText}
        itemType={this.props.itemType}
        readOnly={this.props.readOnly}
        action={() => this.props.toggleSymlinkChange(filePatch)}
      >
        <Fragment>{detail}</Fragment>
      </FilePatchMetaView>
    );
  }

  renderHunkHeaders(filePatch, orderOffset) {
    return (
      <Fragment>
        <MarkerLayer editor={this.refEditor}>
          {filePatch.getHunks().map((hunk, index) => {
            const startPoint = hunk.getRange().start;
            const startRange = new Range(startPoint, startPoint);

            return (
              <Marker
                editor={this.refEditor}
                key={`hunkHeader-${index}`}
                bufferRange={startRange}
                invalidate="never"
              >
                <FullWidthBlockDecoration
                  editor={this.refEditor}
                  portal={this.fullWidthHeaders}
                  type="block"
                  order={orderOffset + 0.2}
                  className="git-panel-FilePatchView-controlBlock"
                >
                  {this.renderHunkHeader(hunk)}
                </FullWidthBlockDecoration>
              </Marker>
            );
          })}
        </MarkerLayer>
      </Fragment>
    );
  }

  renderHunkHeader = (hunk) => {
    const selectedHunks = new Set(
      Array.from(this.props.selectedRows, (row) => this.props.multiFilePatch.getHunkAt(row)),
    );
    const containsSelection = this.props.selectionMode === "line" && selectedHunks.has(hunk);
    const isSelected = this.props.selectionMode === "hunk" && selectedHunks.has(hunk);
    const suffix = containsSelection
      ? `Selected Line${this.props.selectedRows.size > 1 ? "s" : ""}`
      : `Hunk${selectedHunks.size > 1 ? "s" : ""}`;
    const verb = this.props.stagingStatus === "unstaged" ? "Stage" : "Unstage";
    return (
      <HunkHeaderView
        refTarget={this.refEditorElement}
        hunk={hunk}
        isSelected={isSelected}
        stagingStatus={this.props.stagingStatus}
        selectionMode="line"
        toggleSelectionLabel={`${verb} ${suffix}`}
        discardSelectionLabel={`Discard ${suffix}`}
        tooltips={this.props.tooltips}
        keymaps={this.props.keymaps}
        toggleSelection={() => this.toggleHunkSelection(hunk, containsSelection)}
        discardSelection={() => this.discardHunkSelection(hunk, containsSelection)}
        mouseDown={this.didMouseDownOnHeader}
        itemType={this.props.itemType}
        readOnly={this.props.readOnly}
      />
    );
  };

  renderWordDiffDecorations() {
    return (
      <Fragment>
        {this.renderWordHighlights(
          this.props.multiFilePatch.getWordDeletionLayer(),
          "git-panel-FilePatchView-word--deleted",
        )}
        {this.renderWordHighlights(
          this.props.multiFilePatch.getWordAdditionLayer(),
          "git-panel-FilePatchView-word--added",
        )}
      </Fragment>
    );
  }

  renderWordHighlights(layer, className) {
    return (
      <MarkerLayer editor={this.refEditor} external={layer}>
        <Decoration editor={this.refEditor} type="highlight" className={className} />
      </MarkerLayer>
    );
  }

  renderLineDecorations(ranges, lineClass, { line, gutter, icon, refHolder }) {
    if (ranges.length === 0) {
      return null;
    }

    const holder = refHolder || new RefHolder();
    return (
      <MarkerLayer editor={this.refEditor} handleLayer={holder.setter}>
        {ranges.map((range, index) => {
          return (
            <Marker
              editor={this.refEditor}
              key={`line-${lineClass}-${index}`}
              bufferRange={range}
              invalidate="never"
            />
          );
        })}
        {this.renderDecorations(lineClass, { line, gutter, icon })}
      </MarkerLayer>
    );
  }

  renderDecorationsOnLayer(layer, lineClass, { line, gutter, icon }) {
    if (layer.getMarkerCount() === 0) {
      return null;
    }

    return (
      <MarkerLayer editor={this.refEditor} external={layer}>
        {this.renderDecorations(lineClass, { line, gutter, icon })}
      </MarkerLayer>
    );
  }

  renderDecorations(lineClass, { line, gutter, icon }) {
    return (
      <Fragment>
        {line && (
          <Decoration
            editor={this.refEditor}
            type="line"
            className={lineClass}
            omitEmptyLastRow={false}
          />
        )}
        {gutter && (
          <Fragment>
            {(gutter === true || gutter === "old") && (
              <Decoration
                editor={this.refEditor}
                type="line-number"
                gutterName="old-line-numbers"
                className={lineClass}
                omitEmptyLastRow={false}
              />
            )}
            {(gutter === true || gutter === "new") && (
              <Decoration
                editor={this.refEditor}
                type="line-number"
                gutterName="new-line-numbers"
                className={lineClass}
                omitEmptyLastRow={false}
              />
            )}
            {gutter === true && (
              <Decoration
                editor={this.refEditor}
                type="gutter"
                classOnly={true}
                gutterName="git-panel-comment-icon"
                className={`git-panel-editorCommentGutterIcon empty ${lineClass}`}
                omitEmptyLastRow={false}
              />
            )}
          </Fragment>
        )}
        {icon && (
          <Decoration
            editor={this.refEditor}
            type="line-number"
            gutterName="diff-icons"
            className={lineClass}
            omitEmptyLastRow={false}
          />
        )}
      </Fragment>
    );
  }

  undoLastDiscardFromCoreUndo = () => {
    if (this.props.hasUndoHistory) {
      const selectedFilePatches = Array.from(this.getSelectedFilePatches());
      /* istanbul ignore else */
      if (this.props.itemType === ChangedFileItem) {
        this.props.undoLastDiscard(selectedFilePatches[0], {
          eventSource: { command: "core:undo" },
        });
      }
    }
  };

  undoLastDiscardFromButton = (filePatch) => {
    this.props.undoLastDiscard(filePatch, { eventSource: "button" });
  };

  discardSelectionFromCommand = () => {
    return this.props.discardRows(this.props.selectedRows, this.props.selectionMode, {
      eventSource: { command: "git-panel:discard-selected-lines" },
    });
  };

  toggleHunkSelection(hunk, containsSelection) {
    if (containsSelection) {
      return this.props.toggleRows(this.props.selectedRows, this.props.selectionMode, {
        eventSource: "button",
      });
    } else {
      const changeRows = new Set(
        hunk.getChanges().reduce((rows, change) => {
          for (const row of change.getBufferRows()) rows.push(row);
          return rows;
        }, []),
      );
      return this.props.toggleRows(changeRows, "hunk", { eventSource: "button" });
    }
  }

  discardHunkSelection(hunk, containsSelection) {
    if (containsSelection) {
      return this.props.discardRows(this.props.selectedRows, this.props.selectionMode, {
        eventSource: "button",
      });
    } else {
      const changeRows = new Set(
        hunk.getChanges().reduce((rows, change) => {
          for (const row of change.getBufferRows()) rows.push(row);
          return rows;
        }, []),
      );
      return this.props.discardRows(changeRows, "hunk", { eventSource: "button" });
    }
  }

  didMouseDownOnHeader(event, hunk) {
    this.nextSelectionMode = "hunk";
    this.handleSelectionEvent(event, hunk.getRange());
  }

  didMouseDownOnLineNumber(event) {
    const line = event.bufferRow;
    if (line === undefined || isNaN(line)) {
      return;
    }

    this.nextSelectionMode = "line";
    if (
      this.handleSelectionEvent(event.domEvent, [
        [line, 0],
        [line, Infinity],
      ])
    ) {
      this.mouseSelectionInProgress = true;
    }
  }

  didMouseMoveOnLineNumber(event) {
    if (!this.mouseSelectionInProgress) {
      return;
    }

    const line = event.bufferRow;
    if (this.lastMouseMoveLine === line || line === undefined || isNaN(line)) {
      return;
    }
    this.lastMouseMoveLine = line;

    this.nextSelectionMode = "line";
    this.handleSelectionEvent(
      event.domEvent,
      [
        [line, 0],
        [line, Infinity],
      ],
      { add: true },
    );
  }

  didMouseUp() {
    this.mouseSelectionInProgress = false;
  }

  handleSelectionEvent(event, rangeLike, opts) {
    if (event.button !== 0) {
      return false;
    }

    const isWindows = process.platform === "win32";
    if (event.ctrlKey && !isWindows) {
      // Allow the context menu to open.
      return false;
    }

    if (this.state.diffView === "side-by-side") {
      this.refSideBySide.map((view) => view.handleSelectionEvent(event, rangeLike, opts));
      return true;
    }

    const options = {
      add: false,
      ...opts,
    };

    // Normalize the target selection range
    const converted = Range.fromObject(rangeLike);
    const range = this.refEditor
      .map((editor) => editor.clipBufferRange(converted))
      .getOr(converted);

    if (event.metaKey || /* istanbul ignore next */ (event.ctrlKey && isWindows)) {
      this.refEditor.map((editor) => {
        let intersects = false;
        let without = null;

        for (const selection of editor.getSelections()) {
          if (selection.intersectsBufferRange(range)) {
            // Remove range from this selection by truncating it to the "near edge" of the range and creating a
            // new selection from the "far edge" to the previous end. Omit either side if it is empty.
            intersects = true;
            const selectionRange = selection.getBufferRange();

            const newRanges = [];

            if (!range.start.isEqual(selectionRange.start)) {
              // Include the bit from the selection's previous start to the range's start.
              let nudged = range.start;
              if (range.start.column === 0) {
                const lastColumn = editor.getBuffer().lineLengthForRow(range.start.row - 1);
                nudged = [range.start.row - 1, lastColumn];
              }

              newRanges.push([selectionRange.start, nudged]);
            }

            if (!range.end.isEqual(selectionRange.end)) {
              // Include the bit from the range's end to the selection's end.
              let nudged = range.end;
              const lastColumn = editor.getBuffer().lineLengthForRow(range.end.row);
              if (range.end.column === lastColumn) {
                nudged = [range.end.row + 1, 0];
              }

              newRanges.push([nudged, selectionRange.end]);
            }

            if (newRanges.length > 0) {
              selection.setBufferRange(newRanges[0]);
              for (const newRange of newRanges.slice(1)) {
                editor.addSelectionForBufferRange(newRange, { reversed: selection.isReversed() });
              }
            } else {
              without = selection;
            }
          }
        }

        if (without !== null) {
          const replacementRanges = editor
            .getSelections()
            .filter((each) => each !== without)
            .map((each) => each.getBufferRange());
          if (replacementRanges.length > 0) {
            editor.setSelectedBufferRanges(replacementRanges);
          }
        }

        if (!intersects) {
          // Add this range as a new, distinct selection.
          editor.addSelectionForBufferRange(range);
        }

        return null;
      });
    } else if (options.add || event.shiftKey) {
      // Extend the existing selection to encompass this range.
      this.refEditor.map((editor) => {
        const lastSelection = editor.getLastSelection();
        const lastSelectionRange = lastSelection.getBufferRange();

        // You are now entering the wall of ternery operators. This is your last exit before the tollbooth
        const isBefore = range.start.isLessThan(lastSelectionRange.start);
        const farEdge = isBefore ? range.start : range.end;
        const newRange = isBefore
          ? [farEdge, lastSelectionRange.end]
          : [lastSelectionRange.start, farEdge];

        lastSelection.setBufferRange(newRange, { reversed: isBefore });
        return null;
      });
    } else {
      this.refEditor.map((editor) => editor.setSelectedBufferRange(range));
    }

    return true;
  }

  didConfirm() {
    return this.props.toggleRows(this.props.selectedRows, this.props.selectionMode);
  }

  didToggleSelectionMode() {
    const selectedHunks = this.getSelectedHunks();
    this.withSelectionMode({
      line: () => {
        const hunkRanges = selectedHunks.map((hunk) => hunk.getRange());
        this.nextSelectionMode = "hunk";
        this.setCanonicalSelectionRanges(hunkRanges);
      },
      hunk: () => {
        let firstChangeRow = Infinity;
        for (const hunk of selectedHunks) {
          const [firstChange] = hunk.getChanges();
          /* istanbul ignore else */
          if (
            firstChange &&
            (!firstChangeRow || firstChange.getStartBufferRow() < firstChangeRow)
          ) {
            firstChangeRow = firstChange.getStartBufferRow();
          }
        }

        this.nextSelectionMode = "line";
        this.setCanonicalSelectionRanges([
          [
            [firstChangeRow, 0],
            [firstChangeRow, Infinity],
          ],
        ]);
      },
    });
  }

  didToggleModeChange = () => {
    return Promise.all(
      Array.from(this.getSelectedFilePatches())
        .filter((fp) => fp.didChangeExecutableMode())
        .map(this.props.toggleModeChange),
    );
  };

  didToggleSymlinkChange = () => {
    return Promise.all(
      Array.from(this.getSelectedFilePatches())
        .filter((fp) => fp.hasTypechange())
        .map(this.props.toggleSymlinkChange),
    );
  };

  selectNextHunk() {
    if (!this.getCanonicalSelectionRanges().length) return this.selectFirstVisibleHunk();
    const nextHunks = new Set(this.withSelectedHunks((hunk) => this.getHunkAfter(hunk) || hunk));
    const nextRanges = Array.from(nextHunks, (hunk) => hunk.getRange());
    this.nextSelectionMode = "hunk";
    this.setCanonicalSelectionRanges(nextRanges);
  }

  selectPreviousHunk() {
    if (!this.getCanonicalSelectionRanges().length) return this.selectFirstVisibleHunk();
    const nextHunks = new Set(this.withSelectedHunks((hunk) => this.getHunkBefore(hunk) || hunk));
    const nextRanges = Array.from(nextHunks, (hunk) => hunk.getRange());
    this.nextSelectionMode = "hunk";
    this.setCanonicalSelectionRanges(nextRanges);
  }

  selectFirstVisibleHunk() {
    const file = this.props.multiFilePatch
      .getFilePatches()
      .find((patch) => patch.getRenderStatus().isVisible() && patch.getHunks().length);
    if (!file) return;
    this.nextSelectionMode = "hunk";
    this.setCanonicalSelectionRanges([file.getHunks()[0].getRange()]);
  }

  didOpenFile({ selectedFilePatch }) {
    const cursorsByFilePatch = new Map();

    this.refEditor.map((editor) => {
      const placedRows = new Set();

      const positions =
        this.state.diffView === "side-by-side"
          ? this.refSideBySide.get().getCanonicalCursorPositions()
          : editor.getCursorBufferPositions();
      for (const position of positions) {
        const cursorRow = position.row;
        const hunk = this.props.multiFilePatch.getHunkAt(cursorRow);
        const filePatch = this.props.multiFilePatch.getFilePatchAt(cursorRow);
        /* istanbul ignore next */
        if (!hunk) {
          continue;
        }

        let newRow = hunk.getNewRowAt(cursorRow);
        let newColumn = position.column;
        if (newRow === null) {
          let nearestRow = hunk.getNewStartRow();
          for (const region of hunk.getRegions()) {
            if (!region.includesBufferRow(cursorRow)) {
              region.when({
                unchanged: () => {
                  nearestRow += region.bufferRowCount();
                },
                addition: () => {
                  nearestRow += region.bufferRowCount();
                },
              });
            } else {
              break;
            }
          }

          if (!placedRows.has(nearestRow)) {
            newRow = nearestRow;
            newColumn = 0;
            placedRows.add(nearestRow);
          }
        }

        if (newRow !== null) {
          // Why is this needed? I _think_ everything is in terms of buffer position
          // so there shouldn't be an off-by-one issue
          newRow -= 1;
          const cursors = cursorsByFilePatch.get(filePatch);
          if (!cursors) {
            cursorsByFilePatch.set(filePatch, [[newRow, newColumn]]);
          } else {
            cursors.push([newRow, newColumn]);
          }
        }
      }

      return null;
    });

    const filePatchesWithCursors = new Set(cursorsByFilePatch.keys());
    if (selectedFilePatch && !filePatchesWithCursors.has(selectedFilePatch)) {
      const [firstHunk] = selectedFilePatch.getHunks();
      const cursorRow = firstHunk ? firstHunk.getNewStartRow() - 1 : /* istanbul ignore next */ 0;
      return this.props.openFile(selectedFilePatch, [[cursorRow, 0]], true);
    } else {
      const pending = cursorsByFilePatch.size === 1;
      return Promise.all(
        Array.from(cursorsByFilePatch, (value) => {
          const [filePatch, cursors] = value;
          return this.props.openFile(filePatch, cursors, pending);
        }),
      );
    }
  }

  getSelectedRows() {
    return new Set(
      this.getCanonicalSelectionRanges().reduce((acc, range) => {
        for (const row of range.getRows()) {
          if (this.isChangeRow(row)) {
            acc.push(row);
          }
        }
        return acc;
      }, []),
    );
  }

  getCanonicalSelectionRanges() {
    if (this.state?.diffView === "side-by-side")
      return this.refSideBySide.map((view) => view.getCanonicalSelectionRanges()).getOr([]);
    return this.refEditor.map((editor) => editor.getSelectedBufferRanges()).getOr([]);
  }

  setCanonicalSelectionRanges(ranges, options) {
    if (this.state?.diffView === "side-by-side") {
      this.refSideBySide.map((view) => view.setCanonicalSelectionRanges(ranges, options));
    } else {
      this.refEditor.map((editor) => editor.setSelectedBufferRanges(ranges, options));
    }
  }

  didAddSelection() {
    this.didChangeSelectedRows();
  }

  didChangeSelectionRange(event) {
    if (
      !event ||
      event.oldBufferRange.start.row !== event.newBufferRange.start.row ||
      event.oldBufferRange.end.row !== event.newBufferRange.end.row
    ) {
      this.didChangeSelectedRows();
    }
  }

  didDestroySelection() {
    this.didChangeSelectedRows();
  }

  didChangeSelectedRows() {
    if (this.suppressChanges) {
      return;
    }

    const nextCursorRows = this.refEditor
      .map((editor) => {
        const positions =
          this.state.diffView === "side-by-side"
            ? this.refSideBySide.map((view) => view.getCanonicalCursorPositions()).getOr([])
            : editor.getCursorBufferPositions();
        return positions.map((position) => position.row);
      })
      .getOr([]);
    const hasMultipleFileSelections = this.props.multiFilePatch.spansMultipleFiles(nextCursorRows);

    this.props.selectedRowsChanged(
      this.getSelectedRows(),
      this.nextSelectionMode || "line",
      hasMultipleFileSelections,
    );
  }

  oldLineNumberLabel({ bufferRow, softWrapped }) {
    const hunk = this.props.multiFilePatch.getHunkAt(bufferRow);
    if (hunk === undefined) {
      return this.pad("");
    }

    const oldRow = hunk.getOldRowAt(bufferRow);
    if (softWrapped) {
      return this.pad(oldRow === null ? "" : "•");
    }

    return this.pad(oldRow);
  }

  newLineNumberLabel({ bufferRow, softWrapped }) {
    const hunk = this.props.multiFilePatch.getHunkAt(bufferRow);
    if (hunk === undefined) {
      return this.pad("");
    }

    const newRow = hunk.getNewRowAt(bufferRow);
    if (softWrapped) {
      return this.pad(newRow === null ? "" : "•");
    }
    return this.pad(newRow);
  }

  /*
   * Return a Set of the Hunks that include at least one editor selection. The selection need not contain an actual
   * change row.
   */
  getSelectedHunks() {
    return this.withSelectedHunks((each) => each);
  }

  withSelectedHunks(callback) {
    const seen = new Set();
    return this.getCanonicalSelectionRanges().reduce((acc, range) => {
      for (const row of range.getRows()) {
        const hunk = this.props.multiFilePatch.getHunkAt(row);
        if (!hunk || seen.has(hunk)) {
          continue;
        }

        seen.add(hunk);
        acc.push(callback(hunk));
      }
      return acc;
    }, []);
  }

  /*
   * Return a Set of FilePatches that include at least one editor selection. The selection need not contain an actual
   * change row.
   */
  getSelectedFilePatches() {
    const patches = new Set();
    for (const range of this.getCanonicalSelectionRanges()) {
      for (const row of range.getRows()) {
        const patch = this.props.multiFilePatch.getFilePatchAt(row);
        if (patch) patches.add(patch);
      }
    }
    return patches;
  }

  getHunkBefore(hunk) {
    const prevRow = hunk.getRange().start.row - 1;
    return this.props.multiFilePatch.getHunkAt(prevRow);
  }

  getHunkAfter(hunk) {
    const nextRow = hunk.getRange().end.row + 1;
    return this.props.multiFilePatch.getHunkAt(nextRow);
  }

  isChangeRow(bufferRow) {
    const changeLayers = [
      this.props.multiFilePatch.getAdditionLayer(),
      this.props.multiFilePatch.getDeletionLayer(),
    ];
    return changeLayers.some((layer) => layer.findMarkers({ intersectsRow: bufferRow }).length > 0);
  }

  withSelectionMode(callbacks) {
    const callback = callbacks[this.props.selectionMode];
    /* istanbul ignore if */
    if (!callback) {
      throw new Error(`Unknown selection mode: ${this.props.selectionMode}`);
    }
    return callback();
  }

  pad(num) {
    const maxDigits = this.props.multiFilePatch.getMaxLineNumberWidth();
    if (num === null) {
      return NBSP_CHARACTER.repeat(maxDigits);
    } else {
      return NBSP_CHARACTER.repeat(maxDigits - num.toString().length) + num.toString();
    }
  }

  scrollToFile = ({ changedFilePath, changedFilePosition }) => {
    /* istanbul ignore next */
    this.refEditor.map((e) => {
      const row = this.props.multiFilePatch.getBufferRowForDiffPosition(
        changedFilePath,
        changedFilePosition,
      );
      if (row === null) {
        return null;
      }

      if (this.state.diffView === "side-by-side") {
        this.refSideBySide.map((view) => view.goToPatchPosition({ row, column: 0 }));
        return null;
      }

      e.setCursorBufferPosition({ row, column: 0 }, { autoscroll: false });
      e.scrollToBufferPosition({ row, column: 0 }, { center: true });
      return null;
    });
  };

  goToSourceLine(lineNumber) {
    if (this.destroyed) return;
    let nearestRow = null;
    let nearestDistance = Infinity;
    for (const patch of this.props.multiFilePatch.getFilePatches()) {
      for (const hunk of patch.getHunks()) {
        for (const row of hunk.getRange().getRows()) {
          const sourceLine = hunk.getNewRowAt(row);
          if (sourceLine === null || sourceLine === undefined) continue;
          const distance = Math.abs(sourceLine - lineNumber);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestRow = row;
          }
        }
      }
    }
    if (nearestRow !== null)
      this.refEditor.map((editor) => {
        if (this.state.diffView === "side-by-side") {
          this.refSideBySide.map((view) => view.goToPatchPosition({ row: nearestRow, column: 0 }));
          return;
        }
        editor.setCursorBufferPosition([nearestRow, 0], { autoscroll: false });
        editor.scrollToBufferPosition([nearestRow, 0], { center: true });
      });
  }

  measurePerformance(action) {
    /* istanbul ignore else */
    if (
      (action === "update" || action === "mount") &&
      performance.getEntriesByName(`MultiFilePatchView-${action}-start`).length > 0
    ) {
      performance.mark(`MultiFilePatchView-${action}-end`);
      performance.measure(
        `MultiFilePatchView-${action}`,
        `MultiFilePatchView-${action}-start`,
        `MultiFilePatchView-${action}-end`,
      );
      performance.clearMarks(`MultiFilePatchView-${action}-start`);
      performance.clearMarks(`MultiFilePatchView-${action}-end`);
      performance.clearMeasures(`MultiFilePatchView-${action}`);
    }
  }
}
