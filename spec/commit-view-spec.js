/** @babel */
/** @jsx h */
import { createRequire } from "node:module";
import path from "path";

import { h, flushViews, createViewHost } from "./helpers/etch.js";
import { Disposable, TextBuffer } from "lumine";

import CommitView from "../lib/views/commit-view.js";

const require = createRequire(import.meta.url);

describe("the commit view controls", () => {
  let container, root, messageBuffer, tooltipManager, config, currentBranch;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createViewHost(container);
    messageBuffer = new TextBuffer();
    const disposable = () => ({ dispose() {} });
    tooltipManager = {
      add: jasmine.createSpy("add tooltip").and.callFake(disposable),
      addComposite: jasmine.createSpy("add composite tooltip").and.callFake(disposable),
    };
    config = {
      get: () => false,
      onDidChange: () => new Disposable(),
    };
    currentBranch = {
      getName: () => "main",
      isDetached: () => false,
      isPresent: () => true,
    };
  });

  afterEach(async () => {
    await flushViews(async () => root.destroy());
    messageBuffer.destroy();
    container.remove();
  });

  async function renderCommitView(overrides = {}) {
    await flushViews(async () => {
      root.update(
        <CommitView
          workspace={lumine.workspace}
          commands={lumine.commands}
          tooltips={tooltipManager}
          config={config}
          stagedChangesExist={false}
          mergeConflictsExist={false}
          prepareToCommit={() => Promise.resolve(true)}
          commit={() => Promise.resolve()}
          abortMerge={() => {}}
          maximumCharacterLimit={72}
          messageBuffer={messageBuffer}
          isMerging={false}
          isCommitting={false}
          lastCommit={{ isPresent: () => true }}
          currentBranch={currentBranch}
          toggleExpandedCommitMessageEditor={() => {}}
          deactivateCommitBox={false}
          userStore={{}}
          {...overrides}
          selectedCoAuthors={[]}
          updateSelectedCoAuthors={() => {}}
        />,
      );
    });
  }

  it("uses cached message validity during availability queries and observes edits", async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    messageBuffer.setText("message");
    await renderCommitView({ stagedChangesExist: true });
    const read = spyOn(messageBuffer, "getText").and.callThrough();
    const target = lumine.workspace.getElement();
    for (let i = 0; i < 5; i++)
      expect(lumine.commands.canDispatch(target, "git-panel:commit")).toBe(true);
    expect(read).not.toHaveBeenCalled();
    messageBuffer.setText("# comment only");
    expect(lumine.commands.canDispatch(target, "git-panel:commit")).toBe(false);
  });

  it("invalidates global commit availability only when its Boolean result changes", async () => {
    messageBuffer.setText("first");
    await renderCommitView({ stagedChangesExist: true });
    const invalidate = spyOn(lumine.commands, "invalidateAvailability").and.callThrough();
    messageBuffer.setText("second valid message");
    expect(invalidate).not.toHaveBeenCalled();
    messageBuffer.setText("# comment");
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("allows a first commit while refusing to amend an unborn HEAD", async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    messageBuffer.setText("first commit");
    await renderCommitView({
      stagedChangesExist: true,
      lastCommit: { isPresent: () => true, isUnbornRef: () => true },
    });
    expect(lumine.commands.canDispatch(lumine.workspace.getElement(), "git-panel:commit")).toBe(
      true,
    );
    expect(
      lumine.commands.canDispatch(lumine.workspace.getElement(), "git-panel:amend-last-commit"),
    ).toBe(false);
  });

  it("keeps the character count immediately before the expand button in the message toolbar", async () => {
    await renderCommitView();

    const editor = container.querySelector(".git-panel-CommitView-editor");
    const controls = editor.querySelector(".git-panel-CommitView-editorControls");
    const messageEditor = editor.querySelector("lumine-text-editor");
    const characterCount = controls.querySelector(".git-panel-CommitView-remaining-characters");
    const expandButton = controls.querySelector(".git-panel-CommitView-expandButton");
    const bar = container.querySelector(".git-panel-CommitView-bar");

    expect(messageEditor.classList).toContain("git-panel-CommitView-messageEditor");
    expect(characterCount.nextElementSibling).toBe(expandButton);
    expect(bar.querySelector(".git-panel-CommitView-remaining-characters")).toBeNull();
    const visibleControls = [...bar.children].filter((element) => !element.hidden);
    expect(visibleControls.at(-1)).toBe(bar.querySelector(".git-panel-CommitView-commit"));
  });

  it("shows the hard-wrap control when a message gains a body and hides it when cleared", async () => {
    await renderCommitView();
    const button = container.querySelector(".git-panel-CommitView-hardwrap");
    expect(button.children.length).toBe(0);

    await flushViews(() => messageBuffer.setText("Subject\n\nMessage body."));
    expect(button.querySelector("svg")).not.toBeNull();

    await flushViews(() => messageBuffer.setText(""));
    expect(button.children.length).toBe(0);
  });

  it("does not scroll an empty commit editor past the end", async () => {
    const previousScrollPastEnd = lumine.config.get("editor.scrollPastEnd");
    const stylesheet = lumine.themes.requireStylesheet(
      path.join(import.meta.dirname, "..", "styles", "main.css"),
    );
    container.style.width = "400px";
    container.style.setProperty("--editor-line-height", "24px");

    try {
      lumine.config.set("editor.scrollPastEnd", true);
      await renderCommitView();

      const messageEditor = container.querySelector(".git-panel-CommitView-messageEditor");
      const editorComponent = messageEditor.getComponent();
      const verticalScrollbar = messageEditor.querySelector(".vertical-scrollbar");
      await globalThis.waitForFrames(() => editorComponent.hasInitialMeasurements, {
        description: "commit editor measurements",
      });

      expect(messageEditor.getModel().getScrollPastEnd()).toBe(false);
      expect(messageEditor.getMaxScrollTop()).toBe(0);
      expect(editorComponent.canScrollVertically()).toBe(false);
      expect(getComputedStyle(verticalScrollbar).visibility).toBe("hidden");
    } finally {
      lumine.config.set("editor.scrollPastEnd", previousScrollPastEnd);
      await globalThis.flushMicrotasks();
      stylesheet.dispose();
    }
  });

  it("targets the message editor and commit button with their own context menus", () => {
    const menu = require("../menus/main.json")["context-menu"];
    expect(
      menu[".git-panel-CommitView-messageEditor"].map((item) => item.command).filter(Boolean),
    ).toEqual(["git-panel:toggle-expanded-commit-message-editor"]);
    expect(
      menu[".git-panel-CommitView-commit"].map((item) => item.command).filter(Boolean),
    ).toEqual(["git-panel:commit", "git-panel:amend-last-commit"]);
  });
});
