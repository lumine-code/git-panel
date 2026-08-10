/** @babel */
/** @jsx React.createElement */
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import StatusBar from "../lib/lumine/status-bar";
import ChangedFilesCountView from "../lib/views/changed-files-count-view";

// The status bar stamps this on whatever it hosts, and a theme draws a tile's
// padding, hover and pill from it. See `status-bar/lib/tile.js`.
const TILE_CLASS = "status-bar-item";

// Stands in for the real bar: all that matters here is that it marks the
// element it is handed, exactly as `StatusBarView#addRightTile` does.
function buildStatusBar() {
  const tiles = [];
  return {
    tiles,
    addRightTile({ item, priority }) {
      item.classList.add(TILE_CLASS);
      tiles.push({ item, priority });
      return { destroy: () => item.classList.remove(TILE_CLASS) };
    },
  };
}

describe("the status bar tile group", () => {
  let container, root, wasActEnvironment;

  beforeEach(() => {
    // What `act` checks for before it will flush an update without warning.
    wasActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
    global.IS_REACT_ACT_ENVIRONMENT = true;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    global.IS_REACT_ACT_ENVIRONMENT = wasActEnvironment;
  });

  async function render(element) {
    await act(async () => root.render(element));
  }

  it("leaves the mark on the host when it carries a single control", async () => {
    const statusBar = buildStatusBar();
    await render(
      <StatusBar statusBar={statusBar}>
        <span>one</span>
      </StatusBar>,
    );

    expect(statusBar.tiles[0].item.classList.contains(TILE_CLASS)).toBe(true);
  });

  it("takes the mark off a host that groups several controls", async () => {
    const statusBar = buildStatusBar();
    await render(
      <StatusBar statusBar={statusBar} hostsTiles>
        <span>one</span>
        <span>two</span>
      </StatusBar>,
    );

    // A tile is one control: were the group still marked, a theme would paint
    // one padding box and one hover rectangle across every control in it.
    expect(statusBar.tiles[0].item.classList.contains(TILE_CLASS)).toBe(false);
  });

  it("marks the changed-files count as a tile of its own", async () => {
    await render(<ChangedFilesCountView changedFilesCount={3} />);

    const button = container.querySelector(".git-panel-ChangedFilesCount");
    expect(button.classList.contains(TILE_CLASS)).toBe(true);
  });
});
