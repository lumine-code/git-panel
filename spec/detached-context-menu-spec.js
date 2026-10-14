/** @babel */
import ContextMenuInterceptor from "../lib/context-menu-interceptor.js";

describe("patch context-menu capture across documents", () => {
  let view;
  afterEach(async () => {
    view?.destroy();
    await lumine.workspace.discardEditorWindows();
  });
  it("intercepts a local auxiliary event and retires the listener with its view", async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    spyOn(lumine.contextMenu, "showForEvent");
    const extra = await lumine.workspace.openEditorWindow({ show: false });
    const callback = jasmine.createSpy("prepare local context");
    view = new ContextMenuInterceptor({ onWillShowContextMenu: callback }, []);
    extra.getElement().appendChild(view.element);
    const element = view.element;
    const MouseEvent = extra.getDOMWindow().MouseEvent;
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(callback).toHaveBeenCalledTimes(1);
    view.destroy();
    view = null;
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
