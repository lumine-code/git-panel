/** @babel */
import path from "path";

describe("file patch list selection styles", () => {
  it("joins adjacent rounded selections within each staged or unstaged list", () => {
    const stylesheet = lumine.themes.requireStylesheet(
      path.join(__dirname, "..", "styles", "file-patch-list-view.css"),
    );
    const themeStyle = document.createElement("style");
    themeStyle.textContent = `
      .git-panel-FilePatchListView > .git-panel-FilePatchListView-item {
        border-radius: 6px;
      }
    `;
    document.head.appendChild(themeStyle);

    const list = document.createElement("div");
    list.classList.add("git-panel-FilePatchListView");
    const row = (selected = false) => {
      const element = document.createElement("div");
      element.classList.add("git-panel-FilePatchListView-item");
      if (selected) element.classList.add("is-selected");
      return element;
    };
    const first = row(true);
    const middle = row(true);
    const last = row(true);
    const isolated = row(true);
    list.append(first, middle, last, row(), isolated);
    jasmine.attachToDOM(list);

    try {
      expect(getComputedStyle(first).borderTopLeftRadius).toBe("6px");
      expect(getComputedStyle(first).borderBottomLeftRadius).toBe("0px");
      expect(getComputedStyle(middle).borderTopLeftRadius).toBe("0px");
      expect(getComputedStyle(middle).borderBottomLeftRadius).toBe("0px");
      expect(getComputedStyle(last).borderTopLeftRadius).toBe("0px");
      expect(getComputedStyle(last).borderBottomLeftRadius).toBe("6px");
      expect(getComputedStyle(isolated).borderRadius).toBe("6px");
    } finally {
      list.remove();
      themeStyle.remove();
      stylesheet.dispose();
    }
  });
});
