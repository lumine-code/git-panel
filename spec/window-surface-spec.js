/** @babel */
import MultiFilePatchView from "../lib/views/multi-file-patch-view";
import GitTimingsView from "../lib/views/git-timings-view";
import GitTabController from "../lib/controllers/git-tab-controller";
import TabTracker from "../lib/controllers/tab-tracker";
import CoAuthorForm from "../lib/views/co-author-form";
import CommitView from "../lib/views/commit-view";
import GitTabView from "../lib/views/git-tab-view";
import StagingView from "../lib/views/staging-view";
import RefHolder from "../lib/models/ref-holder";
import TabGroup from "../lib/tab-group";

describe("window surfaces", () => {
  let sourceFrame, destinationFrame;

  beforeEach(() => {
    sourceFrame = document.createElement("iframe");
    destinationFrame = document.createElement("iframe");
    jasmine.attachToDOM(sourceFrame);
    jasmine.attachToDOM(destinationFrame);
  });

  afterEach(() => {
    sourceFrame.remove();
    destinationFrame.remove();
  });

  it("reads tab-group focus from the elements' Document", () => {
    const input = sourceFrame.contentDocument.createElement("input");
    sourceFrame.contentDocument.body.appendChild(input);
    const group = new TabGroup();
    group.appendElement(input);

    input.focus();

    expect(group.getCurrentFocus()).toBe(input);
  });

  it("moves patch mouse listeners with their pane item", () => {
    const itemElement = sourceFrame.contentDocument.createElement("div");
    const root = sourceFrame.contentDocument.createElement("div");
    itemElement.appendChild(root);
    sourceFrame.contentDocument.body.appendChild(itemElement);

    const view = Object.create(MultiFilePatchView.prototype);
    view.refRoot = RefHolder.on(root);
    view.didMouseUp = jasmine.createSpy("didMouseUp");
    view.surfaceWindow = null;
    view.bindSurfaceWindow();

    sourceFrame.contentWindow.dispatchEvent(new sourceFrame.contentWindow.MouseEvent("mouseup"));
    expect(view.didMouseUp).toHaveBeenCalledTimes(1);

    const transition = view.observeSurfaceTransition({
      item: { getElement: () => itemElement },
    });
    destinationFrame.contentDocument.body.appendChild(itemElement);
    transition.commit();

    sourceFrame.contentWindow.dispatchEvent(new sourceFrame.contentWindow.MouseEvent("mouseup"));
    destinationFrame.contentWindow.dispatchEvent(
      new destinationFrame.contentWindow.MouseEvent("mouseup"),
    );
    expect(view.didMouseUp).toHaveBeenCalledTimes(2);

    view.unbindSurfaceWindow();
  });

  it("moves staging mouse listeners with their pane item", () => {
    const itemElement = sourceFrame.contentDocument.createElement("div");
    const root = sourceFrame.contentDocument.createElement("div");
    itemElement.appendChild(root);
    sourceFrame.contentDocument.body.appendChild(itemElement);

    const view = Object.create(StagingView.prototype);
    view.refRoot = RefHolder.on(root);
    view.mouseup = jasmine.createSpy("mouseup");
    view.surfaceWindow = null;
    view.bindSurfaceWindow();

    sourceFrame.contentWindow.dispatchEvent(new sourceFrame.contentWindow.MouseEvent("mouseup"));
    expect(view.mouseup).toHaveBeenCalledTimes(1);

    const transition = view.observeSurfaceTransition({
      item: { getElement: () => itemElement },
    });
    destinationFrame.contentDocument.body.appendChild(itemElement);
    transition.commit();

    sourceFrame.contentWindow.dispatchEvent(new sourceFrame.contentWindow.MouseEvent("mouseup"));
    destinationFrame.contentWindow.dispatchEvent(
      new destinationFrame.contentWindow.MouseEvent("mouseup"),
    );
    expect(view.mouseup).toHaveBeenCalledTimes(2);

    view.unbindSurfaceWindow();
  });

  it("reads component focus from the component's Document", () => {
    const root = sourceFrame.contentDocument.createElement("div");
    const input = sourceFrame.contentDocument.createElement("input");
    root.appendChild(input);
    sourceFrame.contentDocument.body.appendChild(root);
    input.focus();

    const controller = Object.create(GitTabController.prototype);
    controller.refRoot = RefHolder.on(root);
    expect(controller.hasFocus()).toBe(true);

    const commit = Object.create(CommitView.prototype);
    commit.refRoot = RefHolder.on(root);
    expect(commit.hasFocus()).toBe(true);

    const staging = Object.create(StagingView.prototype);
    staging.refRoot = RefHolder.on(root);
    expect(staging.hasFocus()).toBe(true);

    const tab = Object.create(GitTabView.prototype);
    tab.props = { refRoot: RefHolder.on(root) };
    expect(tab.hasFocus()).toBe(true);

    const tracker = new TabTracker("git", {
      getWorkspace: () => ({
        paneForURI: () => ({
          itemForURI: () => ({ getElement: () => root }),
        }),
      }),
      uri: "git://panel",
    });
    expect(tracker.hasFocus()).toBe(true);
  });

  it("cycles co-author inputs within their Document", () => {
    const view = Object.create(CoAuthorForm.prototype);
    view.nameInput = sourceFrame.contentDocument.createElement("input");
    view.emailInput = sourceFrame.contentDocument.createElement("input");
    sourceFrame.contentDocument.body.append(view.nameInput, view.emailInput);
    const event = { stopPropagation: jasmine.createSpy("stopPropagation") };

    view.nameInput.focus();
    view.focusNextInput(event);
    expect(sourceFrame.contentDocument.activeElement).toBe(view.emailInput);

    view.focusPreviousInput(event);
    expect(sourceFrame.contentDocument.activeElement).toBe(view.nameInput);
  });

  it("restores dock-toggle focus through the active workspace surface", async () => {
    const invokingInput = sourceFrame.contentDocument.createElement("input");
    const revealedInput = destinationFrame.contentDocument.createElement("input");
    sourceFrame.contentDocument.body.appendChild(invokingInput);
    destinationFrame.contentDocument.body.appendChild(revealedInput);
    invokingInput.focus();

    const workspace = {
      getActiveWindowSurface: () => ({ document: sourceFrame.contentDocument }),
      paneForURI: () => null,
      getPaneContainers: () => [],
      open: async () => revealedInput.focus(),
    };
    const tracker = new TabTracker("git", {
      getWorkspace: () => workspace,
      uri: "git://panel",
    });

    await tracker.toggle();
    await new Promise((resolve) => process.nextTick(resolve));

    expect(sourceFrame.contentDocument.activeElement).toBe(invokingInput);
  });

  it("redispatches staging context menus with the target Window", async () => {
    const parent = sourceFrame.contentDocument.createElement("div");
    const target = sourceFrame.contentDocument.createElement("span");
    parent.appendChild(target);
    sourceFrame.contentDocument.body.appendChild(parent);
    const item = {};
    const selected = new Set();
    const selection = {
      getSelectedItems: () => selected,
      selectItem: () => selection,
    };
    const view = Object.create(StagingView.prototype);
    view.state = { selection };
    view.setState = (updater, callback) => {
      view.state = { ...view.state, ...updater(view.state) };
      callback();
    };
    const redispatched = jasmine.createSpy("redispatched");
    parent.addEventListener("contextmenu", redispatched);
    const nativeEvent = new sourceFrame.contentWindow.MouseEvent("contextmenu", {
      bubbles: true,
    });

    await view.contextMenuOnItem(
      {
        type: nativeEvent.type,
        target,
        nativeEvent,
        shiftKey: false,
        persist: jasmine.createSpy("persist"),
        stopPropagation: jasmine.createSpy("stopPropagation"),
      },
      item,
    );
    await new Promise((resolve) => sourceFrame.contentWindow.requestAnimationFrame(resolve));

    expect(redispatched).toHaveBeenCalled();
    expect(redispatched.calls.mostRecent().args[0]).toEqual(
      jasmine.any(sourceFrame.contentWindow.MouseEvent),
    );
  });

  it("creates the timings file picker in the invoking surface", async () => {
    const listeners = new Map();
    const input = {
      type: "",
      accept: "",
      addEventListener: (name, callback) => listeners.set(name, callback),
      click: () => listeners.get("cancel")(),
    };
    const surfaceDocument = {
      createElement: jasmine.createSpy("createElement").and.returnValue(input),
    };
    const view = Object.create(GitTimingsView.prototype);

    await view.handleImportClick({
      preventDefault: jasmine.createSpy("preventDefault"),
      currentTarget: { ownerDocument: surfaceDocument },
    });

    expect(surfaceDocument.createElement).toHaveBeenCalledOnceWith("input");
  });
});
