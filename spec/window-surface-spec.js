/** @babel */
import MultiFilePatchView from "../lib/views/multi-file-patch-view";
import GitTimingsView from "../lib/views/git-timings-view";
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
