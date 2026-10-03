/** @babel */
import { Emitter } from "lumine";
import { watchWorkspaceItem } from "../lib/watch-workspace-item";

describe("watchWorkspaceItem", () => {
  it("updates URI matches when the active item changes resource", async () => {
    const emitter = new Emitter();
    let uri = "lumine-test://other";
    const item = {
      element: document.createElement("div"),
      getURI: () => uri,
      onDidChangeURI: (callback) => emitter.on("uri", callback),
    };
    await lumine.workspace.open(item);
    const component = {
      state: {},
      updateState(update) {
        Object.assign(this.state, update);
      },
    };
    const watcher = watchWorkspaceItem(
      lumine.workspace,
      "lumine-test://matching",
      component,
      "open",
    );
    expect(component.state.open).toBe(false);
    const oldURI = uri;
    uri = "lumine-test://matching";
    emitter.emit("uri", { oldURI, newURI: uri });
    expect(component.state.open).toBe(true);
    watcher.dispose();
    uri = "lumine-test://other";
    emitter.emit("uri", { oldURI: "lumine-test://matching", newURI: uri });
    expect(component.state.open).toBe(true);
    emitter.dispose();
  });

  it("subscribes to activation with an older workspace API", () => {
    const subscribe = lumine.workspace.onDidChangePaneItemURI;
    lumine.workspace.onDidChangePaneItemURI = undefined;
    try {
      const component = { state: {}, updateState() {} };
      const watcher = watchWorkspaceItem(
        lumine.workspace,
        "lumine-test://matching",
        component,
        "open",
      );
      expect(component.state.open).toBe(false);
      watcher.dispose();
    } finally {
      lumine.workspace.onDidChangePaneItemURI = subscribe;
    }
  });
});
