const path = require("path");

describe("git panel theme roles", () => {
  let stylesheet;
  let container;

  beforeEach(() => {
    stylesheet = lumine.themes.requireStylesheet(path.join(__dirname, "..", "styles", "main.css"));
    container = document.createElement("div");
    container.style.cssText =
      "--accent-indicator-color: rgb(10,20,30); --accent-background-color: rgb(40,50,60); --accent-foreground-color: rgb(230,240,250); --button-background-color-selected: rgb(100,110,120); --button-text-color-selected: rgb(200,210,220); --text-color-selected: rgb(70,80,90);";
    jasmine.attachToDOM(container);
  });

  afterEach(() => {
    container.remove();
    stylesheet.dispose();
  });

  it("keeps selected button colors distinct from focused list options", () => {
    container.innerHTML =
      '<button class="git-panel-StagingView-headerButton selected">Stage</button><div class="git-panel-RepositoryHome-owner"><div class="Select__option Select__option--is-focused">Owner</div></div>';
    const button = getComputedStyle(container.querySelector("button"));
    expect(button.color).toBe("rgb(200, 210, 220)");
    expect(button.backgroundColor).toBe("rgb(100, 110, 120)");
    const option = getComputedStyle(container.querySelector(".Select__option"));
    expect(option.color).toBe("rgb(230, 240, 250)");
    expect(option.backgroundColor).toBe("rgb(40, 50, 60)");
  });

  it("keeps a diagnostic character counter on its UI input surface under a mixed theme pair", () => {
    container.style.setProperty("--input-background-color", "rgb(10,20,30)");
    container.style.setProperty("--syntax-background-color", "rgb(230,240,250)");
    container.style.setProperty("--text-color-warning", "rgb(180,190,200)");
    container.innerHTML =
      '<span class="git-panel-CommitView-remaining-characters is-warning">10</span>';
    const counter = getComputedStyle(container.firstElementChild);
    expect(counter.color).toBe("rgb(180, 190, 200)");
    expect(counter.backgroundColor).toBe("rgb(10, 20, 30)");
  });

  it("uses the indicator accent for focus borders and the accent pair for focused commit rows", () => {
    container.innerHTML =
      '<button class="git-panel-Dialog--insetButton">Focus</button><div tabindex="0" class="git-panel-RecentCommits"><div class="git-panel-RecentCommit is-selected">Commit</div></div>';
    const button = container.querySelector("button");
    button.focus();
    expect(getComputedStyle(button).borderTopColor).toBe("rgb(10, 20, 30)");
    const commits = container.querySelector(".git-panel-RecentCommits");
    commits.focus();
    const selected = getComputedStyle(commits.firstElementChild);
    expect(selected.color).toBe("rgb(230, 240, 250)");
    expect(selected.backgroundColor).toBe("rgb(40, 50, 60)");
  });

  it("colors Git metadata from Git status tokens independently of diagnostic colors", () => {
    container.style.setProperty("--text-color-added", "rgb(20,120,40)");
    container.style.setProperty("--text-color-success", "rgb(180,20,140)");
    container.style.setProperty("--background-color-success", "rgb(190,30,150)");
    container.innerHTML = '<span class="patch-view-FilePatchView-metaDiff--added">Added</span>';
    const added = container.firstElementChild;
    const before = [getComputedStyle(added).color, getComputedStyle(added).backgroundColor];
    container.style.setProperty("--text-color-success", "rgb(1,2,3)");
    container.style.setProperty("--background-color-success", "rgb(4,5,6)");
    expect([getComputedStyle(added).color, getComputedStyle(added).backgroundColor]).toEqual(
      before,
    );
    container.style.setProperty("--text-color-added", "rgb(30,40,130)");
    expect(getComputedStyle(added).color).not.toBe(before[0]);
    expect(getComputedStyle(added).backgroundColor).not.toBe(before[1]);
  });
});
