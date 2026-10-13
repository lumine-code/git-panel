/** @babel */
import path from "path";

import PatchItem from "../lib/items/patch-item.js";
import PatchDocument from "../lib/models/patch-document.js";
import GitTabItem from "../lib/items/git-tab-item.js";
import GitCacheView from "../lib/views/git-cache-view.js";
import GitTimingsView from "../lib/views/git-timings-view.js";
import GitPackage from "../lib/git-package.js";

describe("pane view styles", () => {
  it("matches text editor backgrounds for pane items and their loading hosts", () => {
    const stylesheet = lumine.themes.requireStylesheet(
      path.join(import.meta.dirname, "..", "styles", "main.css"),
    );
    const elements = [
      "git-panel-PaneItemHost-git-patch",
      "git-panel-PaneItemHost-git-timings-view",
      "git-panel-Patch-root",
      "git-panel-GitTimings-root",
      "git-panel-GitCache-root",
      "git-panel-CommitDetailView",
      "git-panel-GitTimingsView",
      "git-panel-CacheView",
    ].map((className) => {
      const element = document.createElement("div");
      element.classList.add(className);
      element.style.setProperty("--syntax-background-color", "rgb(1, 2, 3)");
      jasmine.attachToDOM(element);
      return element;
    });

    try {
      for (const element of elements) {
        expect(getComputedStyle(element).backgroundColor).toBe("rgb(1, 2, 3)");
      }
    } finally {
      for (const element of elements) element.remove();
      stylesheet.dispose();
    }
  });
});

describe("pane item locations", () => {
  it("keeps the main Git panel in the side docks with its default first", () => {
    expect(GitTabItem.prototype.getDefaultLocation()).toBe("right");
    expect(GitTabItem.prototype.getAllowedLocations()).toEqual(["right", "left"]);
  });

  it("keeps editor-like Git views in the workspace center", () => {
    const itemTypes = [PatchItem, GitTimingsView, GitCacheView];

    for (const ItemType of itemTypes) {
      expect(ItemType.prototype.getAllowedLocations()).toEqual(["center"]);
    }
  });
});

describe("pane item host factories", () => {
  it("provides serializable hosts for every Git pane item", () => {
    const packageInstance = { controller: null };
    const factories = [
      [
        GitPackage.prototype.createGitPaneItem,
        { uri: "lumine-git://dock-item/git" },
        "GitDockItem",
      ],
      [
        GitPackage.prototype.createPatchPaneItem,
        {
          uri: PatchDocument.file("b", "a", "staged").getURI(),
          params: { document: PatchDocument.file("b", "a", "staged") },
        },
        "PatchPaneItem",
      ],
      [
        GitPackage.prototype.createPatchPaneItem,
        {
          uri: PatchDocument.staged("b").getURI(),
          params: { document: PatchDocument.staged("b") },
        },
        "PatchPaneItem",
      ],
      [
        GitPackage.prototype.createPatchPaneItem,
        {
          uri: PatchDocument.commit("b", "c").getURI(),
          params: { document: PatchDocument.commit("b", "c") },
        },
        "PatchPaneItem",
      ],
      [
        GitPackage.prototype.createGitTimingsPaneItem,
        { uri: "lumine-git://debug/timings" },
        "GitTimingsView",
      ],
    ];

    for (const [factory, options, deserializer] of factories) {
      const host = factory.call(packageInstance, options);
      expect(host.getHydrationState()).toBe("pending");
      expect(host.serialize()).toEqual(jasmine.objectContaining({ deserializer }));
      if (!host.canCopy()) {
        expect(host.copy()).toBeNull();
      } else {
        const copy = host.copy();
        expect(copy).not.toBe(host);
        expect(copy.getElement()).not.toBe(host.getElement());
        expect(copy.getURI()).toBe(host.getURI());
        expect(copy.getHydrationState()).toBe("pending");
        copy.destroy();
      }
      host.destroy();
    }
  });
});
