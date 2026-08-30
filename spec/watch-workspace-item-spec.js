/** @babel */
import { watchWorkspaceItem } from "../lib/watch-workspace-item";

describe("watchWorkspaceItem", () => {
  it("tracks active items across tiled and detached center panes, but not docks", async () => {
    const matchingItem = { getURI: () => "git-panel://commit-preview" };
    const otherItem = { getURI: () => "git-panel://other" };
    let tiledItem = otherItem;
    let detachedItem = otherItem;
    let dockItem = matchingItem;
    let didChangeActivePaneItem;

    const tiledPane = { getActiveItem: () => tiledItem };
    const detachedPane = { getActiveItem: () => detachedItem };
    const dockPane = { getActiveItem: () => dockItem };
    const center = {
      getPanes: () => [tiledPane, detachedPane],
      onDidChangeActivePaneItem(callback) {
        didChangeActivePaneItem = callback;
        return { dispose() {} };
      },
    };
    const workspace = {
      getCenter: () => center,
      getPanes: () => [...center.getPanes(), dockPane],
    };
    const component = {
      state: null,
      setState(update, callback) {
        Object.assign(this.state, update);
        callback();
      },
    };
    const watcher = watchWorkspaceItem(
      workspace,
      "git-panel://commit-preview",
      component,
      "active",
    );

    expect(component.state.active).toBe(false);

    dockItem = otherItem;
    tiledItem = matchingItem;
    await didChangeActivePaneItem();
    expect(component.state.active).toBe(true);

    tiledItem = otherItem;
    await didChangeActivePaneItem();
    expect(component.state.active).toBe(false);

    detachedItem = matchingItem;
    await didChangeActivePaneItem();
    expect(component.state.active).toBe(true);

    watcher.dispose();
  });
});
