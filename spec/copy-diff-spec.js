/** @babel */
import path from "path";
import { Range } from "lumine";
import ChangesView from "../lib/views/changes-view";
import { buildMultiFilePatch } from "../lib/models/patch";
import { flushViews } from "./helpers/etch";

function hunk(before, oldText, newText, after, start) {
  return {
    oldStartLine: start,
    oldLineCount: 3,
    newStartLine: start,
    newLineCount: 3,
    heading: "",
    lines: [` ${before}`, `-${oldText}`, `+${newText}`, ` ${after}`],
  };
}

function changedFile(
  hunks = [
    hunk("before one", "old one", "new one", "after one", 10),
    hunk("before two", "old two", "new two", "after two", 30),
  ],
) {
  return {
    oldPath: "example.txt",
    newPath: "example.txt",
    oldMode: "100644",
    newMode: "100644",
    status: "modified",
    hunks,
  };
}

const fileHeader = "diff --git a/example.txt b/example.txt\n--- a/example.txt\n+++ b/example.txt\n";
const firstHunk = "@@ -10,3 +10,3 @@\n before one\n-old one\n+new one\n after one\n";
const secondHunk = "@@ -30,3 +30,3 @@\n before two\n-old two\n+new two\n after two\n";
const selectedDiff =
  fileHeader +
  "@@ -10,3 +10,4 @@\n before one\n old one\n+new one\n after one\n" +
  "@@ -30,3 +31,2 @@\n before two\n-old two\n after two\n\n";

describe("copying a diff from mounted chunk controls", () => {
  let view, container, stylesheet, clipboard, repository, discardLines;
  const patches = [];

  beforeEach(() => {
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText = "display:flex;width:1000px;height:500px";
    jasmine.attachToDOM(container);
    clipboard = { write: jasmine.createSpy("copy unified diff").and.resolveTo() };
    repository = {
      getWorkingDirectoryPath: () => path.dirname(__filename),
      applyPatchToIndex: jasmine.createSpy("stage rows").and.resolveTo(),
      stageFiles: jasmine.createSpy("stage files").and.resolveTo(),
      unstageFiles: jasmine.createSpy("unstage files").and.resolveTo(),
      stageFileModeChange: jasmine.createSpy("stage mode").and.resolveTo(),
      stageFileSymlinkChange: jasmine.createSpy("stage symlink").and.resolveTo(),
    };
    discardLines = jasmine.createSpy("discard rows").and.resolveTo();
  });

  afterEach(async () => {
    await view?.destroy();
    view = null;
    for (const patch of patches.splice(0)) patch.dispose();
    container.remove();
    stylesheet.dispose();
  });

  function build(files) {
    const patch = buildMultiFilePatch(files, { largeDiffThreshold: Infinity });
    patches.push(patch);
    return patch;
  }

  async function mount(layout, options = {}) {
    const { files = [changedFile()], ...props } = options;
    view = new ChangesView({
      title: "Changes",
      multiFilePatch: build(files),
      stagingStatus: "unstaged",
      surfaceKind: "file",
      readOnly: false,
      initialDiffView: layout,
      clipboard,
      repository,
      discardLines,
      workspace: lumine.workspace,
      commands: lumine.commands,
      config: lumine.config,
      keymaps: lumine.keymaps,
      tooltips: lumine.tooltips,
      surface: () => {},
      ...props,
    });
    container.appendChild(view.element);
    await flushViews(() => {});
    await flushViews(() => {});
  }

  function controller() {
    return view.refPatchController.get();
  }

  function patchView() {
    return controller().refView.get();
  }

  function selection() {
    return {
      rows: Array.from(controller().state.selectedRows),
      mode: controller().state.selectionMode,
      ranges: patchView()
        .getCanonicalSelectionRanges()
        .map(({ start, end }) => [start.row, start.column, end.row, end.column]),
    };
  }

  async function selectLines(...texts) {
    const lines = controller().props.multiFilePatch.getBuffer().getText().split("\n");
    const rows = texts.map((text) => {
      const row = lines.indexOf(text);
      expect(row).toBeGreaterThanOrEqual(0);
      return row;
    });
    await flushViews(() => {
      // The gutter sets this before selecting rows; the canonical API retains it.
      patchView().nextSelectionMode = "line";
      patchView().setCanonicalSelectionRanges(
        rows.map((row) => new Range([row, 0], [row, Infinity])),
        { autoscroll: false },
      );
    });
    await flushViews(() => {});
    expect(Array.from(controller().state.selectedRows)).toEqual(rows);
    expect(controller().state.selectionMode).toBe("line");
    expect(Array.from(patchView().props.selectedRows)).toEqual(rows);
    expect(patchView().props.selectionMode).toBe("line");
  }

  function copyButton(index) {
    const button = view.element.querySelectorAll(".git-panel-HunkHeaderView-copyButton")[index];
    expect(button).toBeDefined();
    return button;
  }

  function clickCopy(index) {
    const button = copyButton(index);
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    button.focus();
    button.click();
  }

  function expectNoMutation() {
    for (const method of [
      "applyPatchToIndex",
      "stageFiles",
      "unstageFiles",
      "stageFileModeChange",
      "stageFileSymlinkChange",
    ])
      expect(repository[method]).not.toHaveBeenCalled();
    expect(discardLines).not.toHaveBeenCalled();
  }

  for (const layout of ["unified", "side-by-side"]) {
    it(`copies the clicked ${layout} chunk when selected lines belong to another chunk`, async () => {
      await mount(layout);
      await selectLines("new one");
      const before = selection();
      expect(copyButton(1).getAttribute("aria-label")).toBe("Copy Hunk Diff");
      await flushViews(() => clickCopy(1));
      await flushViews(() => {});
      expect(clipboard.write).toHaveBeenCalledOnceWith(fileHeader + secondHunk + "\n");
      expect(copyButton(1).classList.contains("icon-check")).toBe(true);
      expect(selection()).toEqual(before);
      expectNoMutation();
    });

    it(`copies disjoint selected ${layout} changes across chunks with context and adjusted counts`, async () => {
      await mount(layout);
      await selectLines("new one", "old two");
      const before = selection();
      expect(copyButton(0).getAttribute("aria-label")).toBe("Copy Selected Lines as Diff");
      await flushViews(() => clickCopy(0));
      expect(clipboard.write).toHaveBeenCalledOnceWith(selectedDiff);
      expect(selection()).toEqual(before);
      expectNoMutation();
    });

    it(`copies forward changes from a staged ${layout} chunk without unstaging them`, async () => {
      await mount(layout, { stagingStatus: "staged" });
      await flushViews(() => clickCopy(0));
      expect(clipboard.write).toHaveBeenCalledOnceWith(fileHeader + firstHunk + "\n");
      expectNoMutation();
    });

    it(`keeps copy available on a read-only ${layout} commit`, async () => {
      await mount(layout, { readOnly: true, surfaceKind: "commit" });
      expect(view.element.querySelector(".git-panel-HunkHeaderView-stageButton")).toBeNull();
      expect(view.element.querySelector(".git-panel-HunkHeaderView-discardButton")).toBeNull();
      const before = selection();
      await flushViews(() => clickCopy(0));
      expect(clipboard.write).toHaveBeenCalledOnceWith(fileHeader + firstHunk + "\n");
      expect(selection()).toEqual(before);
      expectNoMutation();
    });
  }

  it("copies selected changes across files without copying either complete file", async () => {
    await mount("unified", {
      surfaceKind: undefined,
      files: [
        changedFile([hunk("before one", "old one", "new one", "after one", 10)]),
        {
          ...changedFile([hunk("before other", "old other", "new other", "after other", 30)]),
          oldPath: "another.txt",
          newPath: "another.txt",
        },
      ],
    });
    await selectLines("new one", "old other");
    const before = selection();
    await flushViews(() => clickCopy(0));
    expect(clipboard.write).toHaveBeenCalledOnceWith(
      fileHeader +
        "@@ -10,3 +10,4 @@\n before one\n old one\n+new one\n after one\n" +
        "diff --git a/another.txt b/another.txt\n--- a/another.txt\n+++ b/another.txt\n" +
        "@@ -30,3 +30,2 @@\n before other\n-old other\n after other\n\n",
    );
    expect(selection()).toEqual(before);
    expectNoMutation();
  });

  it("includes the addition mode, native path and missing final newline", async () => {
    await mount("unified", {
      files: [
        {
          oldPath: null,
          newPath: path.join("dir", "new file.txt"),
          oldMode: null,
          newMode: "100755",
          status: "added",
          hunks: [
            {
              oldStartLine: 0,
              oldLineCount: 0,
              newStartLine: 1,
              newLineCount: 1,
              heading: "",
              lines: ["+new", "\\ No newline at end of file"],
            },
          ],
        },
      ],
    });
    await flushViews(() => clickCopy(0));
    expect(clipboard.write).toHaveBeenCalledOnceWith(
      "diff --git a/dir/new file.txt b/dir/new file.txt\n" +
        "new file mode 100755\n--- /dev/null\n+++ b/dir/new file.txt\n" +
        "@@ -0,0 +1,1 @@\n+new\n\\ No newline at end of file\n\n",
    );
    expectNoMutation();
  });

  it("keeps full file deletion headers and the missing final newline", async () => {
    await mount("unified", {
      files: [
        {
          oldPath: "removed.txt",
          newPath: null,
          oldMode: "100644",
          newMode: null,
          status: "deleted",
          hunks: [
            {
              oldStartLine: 1,
              oldLineCount: 1,
              newStartLine: 0,
              newLineCount: 0,
              heading: "",
              lines: ["-gone", "\\ No newline at end of file"],
            },
          ],
        },
      ],
    });
    await flushViews(() => clickCopy(0));
    expect(clipboard.write).toHaveBeenCalledOnceWith(
      "diff --git a/removed.txt b/removed.txt\n" +
        "deleted file mode 100644\n--- a/removed.txt\n+++ /dev/null\n" +
        "@@ -1,1 +0,0 @@\n-gone\n\\ No newline at end of file\n\n",
    );
    expectNoMutation();
  });

  it("captures the clicked snapshot before an asynchronous clipboard write and refresh", async () => {
    let finishWrite;
    clipboard.write.and.returnValue(
      new Promise((resolve) => {
        finishWrite = resolve;
      }),
    );
    await mount("unified", { readOnly: true, surfaceKind: "commit" });
    const oldSnapshot = controller().props.multiFilePatch;
    await flushViews(() => clickCopy(0));
    expect(clipboard.write).toHaveBeenCalledOnceWith(fileHeader + firstHunk + "\n");
    expect(copyButton(0).classList.contains("icon-clippy")).toBe(true);
    expect(copyButton(0).classList.contains("icon-check")).toBe(false);
    await flushViews(() =>
      view.update({
        ...view.props,
        multiFilePatch: build([
          changedFile([hunk("before refresh", "old refresh", "new refresh", "after refresh", 50)]),
        ]),
      }),
    );
    expect(oldSnapshot.isDisposed()).toBe(true);
    finishWrite();
    await flushViews(() => {});
    expect(clipboard.write).toHaveBeenCalledOnceWith(fileHeader + firstHunk + "\n");
    expect(copyButton(0).classList.contains("icon-check")).toBe(false);
    expectNoMutation();
  });

  it("does not show success when the clipboard rejects the write", async () => {
    const notificationManager = { addError: jasmine.createSpy("copy failure") };
    await mount("unified", { notificationManager });
    clipboard.write.and.callFake(async () => {
      throw new Error("Clipboard write rejected");
    });
    await flushViews(() => clickCopy(0));
    expect(copyButton(0).classList.contains("icon-check")).toBe(false);
    expect(notificationManager.addError).toHaveBeenCalledOnceWith("Unable to copy diff", {
      description: "Clipboard write rejected",
      dismissable: true,
    });
    expectNoMutation();
  });

  it("clears earlier success while another copy is pending and keeps it cleared after failure", async () => {
    const notificationManager = { addError: jasmine.createSpy("copy failure") };
    await mount("unified", { notificationManager });
    await flushViews(() => clickCopy(0));
    expect(copyButton(0).classList.contains("icon-check")).toBe(true);
    let rejectWrite;
    clipboard.write.and.returnValue(
      new Promise((resolve, reject) => {
        rejectWrite = reject;
      }),
    );
    await flushViews(() => clickCopy(0));
    expect(clipboard.write).toHaveBeenCalledTimes(2);
    expect(copyButton(0).classList.contains("icon-clippy")).toBe(true);
    expect(copyButton(0).classList.contains("icon-check")).toBe(false);
    rejectWrite(new Error("Clipboard write rejected"));
    await flushViews(() => {});
    expect(copyButton(0).classList.contains("icon-check")).toBe(false);
    expect(notificationManager.addError).toHaveBeenCalledOnceWith("Unable to copy diff", {
      description: "Clipboard write rejected",
      dismissable: true,
    });
    expectNoMutation();
  });

  it("leaves the clipboard unchanged when no changed rows are selected", async () => {
    await mount("unified");
    await flushViews(() =>
      patchView().setCanonicalSelectionRanges([new Range([0, 0], [0, Infinity])], {
        autoscroll: false,
      }),
    );
    expect(Array.from(controller().state.selectedRows)).toEqual([]);
    await controller().copyRows();
    expect(clipboard.write).not.toHaveBeenCalled();
    expectNoMutation();
  });
});
