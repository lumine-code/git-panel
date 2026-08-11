/** @babel */
/** @jsx React.createElement */
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import StatusBar from "../lib/lumine/status-bar";
import ChangedFilesCountView from "../lib/views/changed-files-count-view";

// The status bar stamps this on whatever it hosts, and a theme draws a tile's
// padding, hover and pill from it. See `status-bar/lib/tile.js`.
const TILE_CLASS = "status-bar-item";

// Stands in for the real bar, following the same rule it does: mark the element
// handed over, unless it is a group — then mark the tiles inside it and leave
// the group itself unmarked. See `status-bar/lib/tile.js`.
function buildStatusBar() {
  const tiles = [];
  const marked = (item) =>
    item.tagName.toLowerCase() === "status-bar-tile-group"
      ? Array.from(item.querySelectorAll("status-bar-tile"))
      : [item];
  return {
    tiles,
    addRightTile({ item, priority }) {
      for (const element of marked(item)) element.classList.add(TILE_CLASS);
      tiles.push({ item, priority });
      return {
        destroy: () => {
          for (const element of marked(item)) element.classList.remove(TILE_CLASS);
        },
      };
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

  it("hands over a tile when it carries a single control", async () => {
    const statusBar = buildStatusBar();
    await render(
      <StatusBar statusBar={statusBar}>
        <span>one</span>
      </StatusBar>,
    );

    const host = statusBar.tiles[0].item;
    expect(host.tagName.toLowerCase()).toBe("status-bar-tile");
    expect(host.classList.contains(TILE_CLASS)).toBe(true);
  });

  it("hands over a group when it carries several controls", async () => {
    const statusBar = buildStatusBar();
    await render(
      <StatusBar statusBar={statusBar} hostsTiles>
        <status-bar-tile>one</status-bar-tile>
        <status-bar-tile>two</status-bar-tile>
      </StatusBar>,
    );

    // A tile is one control: were the group itself marked, a theme would paint
    // one padding box and one hover rectangle across every control in it.
    const host = statusBar.tiles[0].item;
    expect(host.tagName.toLowerCase()).toBe("status-bar-tile-group");
    expect(host.classList.contains(TILE_CLASS)).toBe(false);
    for (const tile of host.querySelectorAll("status-bar-tile")) {
      expect(tile.classList.contains(TILE_CLASS)).toBe(true);
    }
  });

  it("renders the changed-files count as a tile of its own", async () => {
    await render(<ChangedFilesCountView changedFilesCount={3} />);

    const control = container.querySelector(".git-panel-ChangedFilesCount");
    expect(control.tagName.toLowerCase()).toBe("status-bar-tile");
  });

  it("advertises the changed-files tile's mouse action and toggle-focus key binding", async () => {
    const tooltipManager = {
      addComposite: jasmine
        .createSpy("addComposite")
        .and.returnValue({ dispose: jasmine.createSpy("dispose") }),
    };
    const keyBindingTarget = document.createElement("div");
    await render(
      <ChangedFilesCountView
        changedFilesCount={3}
        tooltipManager={tooltipManager}
        keyBindingTarget={keyBindingTarget}
      />,
    );

    const [tile, entries] = tooltipManager.addComposite.calls.mostRecent().args;
    expect(tile).toBe(container.querySelector(".git-panel-ChangedFilesCount"));
    expect(entries).toEqual([
      { title: "Toggle Git panel", keyBindingExtra: "LMB" },
      {
        title: "Toggle focus",
        keyBindingCommand: "git-panel:toggle-focus",
        keyBindingTarget,
      },
    ]);
  });
});
