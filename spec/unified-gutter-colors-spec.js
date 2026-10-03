/** @babel */
import path from "path";
import { Disposable } from "lumine";
import MultiFilePatchView from "../lib/views/multi-file-patch-view";
import CommitDetailItem from "../lib/items/commit-detail-item";
import { buildMultiFilePatch } from "../lib/models/patch";
import { flushViews } from "./helpers/etch";

const oldText = "old removed words ".repeat(30);
const newText = "new inserted words ".repeat(30);

describe("native unified diff gutter colors", () => {
  let view;
  let patch;
  let container;
  let stylesheet;
  let icons;

  beforeEach(() => {
    icons = lumine.config.get("git-panel.showDiffIconGutter");
    lumine.config.set("git-panel.showDiffIconGutter", true);
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText = "display: flex; width: 700px; height: 1000px;";
    // Fixed colors make computed-style assertions independent of the active theme.
    container.style.setProperty("--syntax-color-added", "rgb(30, 180, 60)");
    container.style.setProperty("--syntax-color-removed", "rgb(210, 40, 60)");
    jasmine.attachToDOM(container);
  });

  afterEach(async () => {
    await view?.destroy();
    patch?.dispose();
    container.remove();
    stylesheet.dispose();
    lumine.config.set("git-panel.showDiffIconGutter", icons);
  });

  async function paint() {
    await flushViews(async () => {});
    const element = view.refEditor.get().getElement();
    const pending = element.getNextUpdatePromise();
    element.getComponent().scheduleUpdate();
    await pending;
  }

  async function mount(lines = [" before", `-${oldText}`, `+${newText}`, " after"]) {
    patch = buildMultiFilePatch([
      {
        oldPath: "example.txt",
        newPath: "example.txt",
        oldMode: "100644",
        newMode: "100644",
        status: "modified",
        hunks: [
          {
            oldStartLine: 10,
            newStartLine: 20,
            oldLineCount: lines.filter((line) => line[0] === " " || line[0] === "-").length,
            newLineCount: lines.filter((line) => line[0] === " " || line[0] === "+").length,
            heading: "",
            lines,
          },
        ],
      },
    ]);
    view = new MultiFilePatchView({
      multiFilePatch: patch,
      itemType: CommitDetailItem,
      readOnly: true,
      workspace: lumine.workspace,
      commands: lumine.commands,
      config: lumine.config,
      keymaps: lumine.keymaps,
      tooltips: { add: () => new Disposable(), addComposite: () => new Disposable() },
      stagingStatus: "unstaged",
      selectedRows: new Set(),
      selectionMode: "line",
      selectedRowsChanged: () => {},
      openFile: () => {},
      surface: () => {},
    });
    container.appendChild(view.element);
    const editor = view.refEditor.get();
    editor.getElement().setUpdatedSynchronously(false);
    editor.setCursorBufferPosition([0, 0], { autoscroll: false });
    editor.getElement().setScrollTop(0);
    await paint();
    await paint();
    return editor;
  }

  function expectColoredRows(editor, bufferRow, kind) {
    const element = editor.getElement();
    const firstScreenRow = editor.screenRowForBufferRow(bufferRow);
    const nextScreenRow = editor.screenRowForBufferRow(bufferRow + 1);
    expect(nextScreenRow - firstScreenRow).toBeGreaterThan(1);
    for (let screenRow = firstScreenRow; screenRow < nextScreenRow; screenRow++) {
      const line = element.querySelector(`.lines .line[data-screen-row="${screenRow}"]`);
      expect(line).not.toBeNull();
      const background = getComputedStyle(line).backgroundColor;
      expect(background).not.toBe("rgba(0, 0, 0, 0)");
      expect(background).not.toBe("transparent");
      for (const name of ["old-line-numbers", "new-line-numbers", "diff-icons"]) {
        const number = element.querySelector(
          `[gutter-name="${name}"] .line-number[data-screen-row="${screenRow}"]`,
        );
        expect(number).not.toBeNull();
        expect(number.classList.contains(`git-panel-FilePatchView-line--${kind}`)).toBe(true);
        expect(number.classList.contains("git-panel-FilePatchView-line--selected")).toBe(false);
        expect(getComputedStyle(number).backgroundColor).toBe(background);
        expect(number.getBoundingClientRect().height).toBeCloseTo(
          line.getBoundingClientRect().height,
          1,
        );
      }
    }
  }

  it("colors both number gutters and icons like every wrapped added and deleted text row", async () => {
    const editor = await mount();
    expect(view.state.diffView).toBe("unified");
    expect(view.props.selectedRows.size).toBe(0);
    expectColoredRows(editor, 1, "deleted");
    expectColoredRows(editor, 2, "added");
  });

  it("reserves no empty comment column between the numeric gutters and the text", async () => {
    const editor = await mount();
    const element = editor.getElement();
    const comment = editor.gutterWithName("git-panel-comment-icon");
    expect(comment.isVisible()).toBe(false);
    expect(comment.getElement().getBoundingClientRect().width).toBe(0);
    const lastGutter = element.querySelector('[gutter-name="diff-icons"]');
    const viewport = element.getComponent().refs.scrollContainer;
    expect(viewport.getBoundingClientRect().left).toBeCloseTo(
      lastGutter.getBoundingClientRect().right,
      0,
    );
  });

  it("does not reopen an empty comment column when rows are selected", async () => {
    const editor = await mount();
    const comment = editor.gutterWithName("git-panel-comment-icon");
    await flushViews(() => view.update({ ...view.props, selectedRows: new Set([1, 2]) }));
    await paint();
    expect(comment.isVisible()).toBe(false);
    expect(comment.getElement().getBoundingClientRect().width).toBe(0);
    expect(
      editor
        .getDecorations({ gutterName: "git-panel-comment-icon" })
        .every((decoration) => decoration.getProperties().item == null),
    ).toBe(true);
  });

  it("keeps real comment items visible while selected-row backgrounds carry no item", async () => {
    const editor = await mount();
    const marker = editor.markBufferPosition([1, 0]);
    const decoration = editor.decorateMarker(marker, {
      type: "gutter",
      gutterName: "git-panel-comment-icon",
      item: document.createElement("button"),
      class: "actual-review-comment",
    });
    await flushViews(() => view.update({ ...view.props, selectedRows: new Set([1]) }));
    await paint();
    const comment = editor.gutterWithName("git-panel-comment-icon");
    expect(comment.isVisible()).toBe(true);
    expect(comment.getElement().getBoundingClientRect().width).toBeGreaterThan(0);
    expect(comment.getElement().querySelector(".actual-review-comment")).not.toBeNull();
    expect(
      comment
        .getElement()
        .querySelector(
          ".git-panel-editorCommentGutterIcon.empty.git-panel-FilePatchView-line--selected",
        ),
    ).not.toBeNull();
    decoration.destroy();
    marker.destroy();
    await paint();
    expect(comment.isVisible()).toBe(false);
    expect(comment.getElement().getBoundingClientRect().width).toBe(0);
  });

  it("restores change colors after selection is cleared instead of relying on selection tint", async () => {
    const editor = await mount();
    await flushViews(() => view.update({ ...view.props, selectedRows: new Set([1]) }));
    await paint();
    const selected = editor
      .getElement()
      .querySelector('[gutter-name="old-line-numbers"] .line-number[data-buffer-row="1"]');
    expect(selected.classList.contains("git-panel-FilePatchView-line--deleted")).toBe(true);
    expect(selected.classList.contains("git-panel-FilePatchView-line--selected")).toBe(true);
    await flushViews(() => view.update({ ...view.props, selectedRows: new Set() }));
    await paint();
    expectColoredRows(editor, 1, "deleted");
    expectColoredRows(editor, 2, "added");
  });

  it("keeps no-newline annotation gutters neutral while sharing their semantic class", async () => {
    const editor = await mount([
      " before",
      "-old",
      "+new",
      "\\ No newline at end of file",
      " after",
    ]);
    const element = editor.getElement();
    const screenRow = editor.screenRowForBufferRow(3);
    const line = element.querySelector(`.lines .line[data-screen-row="${screenRow}"]`);
    const background = getComputedStyle(line).backgroundColor;
    for (const name of ["old-line-numbers", "new-line-numbers", "diff-icons"]) {
      const number = element.querySelector(
        `[gutter-name="${name}"] .line-number[data-screen-row="${screenRow}"]`,
      );
      expect(number.classList.contains("git-panel-FilePatchView-line--nonewline")).toBe(true);
      expect(number.classList.contains("git-panel-FilePatchView-line--added")).toBe(false);
      expect(number.classList.contains("git-panel-FilePatchView-line--deleted")).toBe(false);
      expect(getComputedStyle(number).backgroundColor).toBe(background);
    }
  });
});
