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

  it("keeps conflict actions readable when their individual backgrounds change", () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    for (const [side, variable] of [
      ["Ours", "--git-panel-conflict-ours"],
      ["Theirs", "--syntax-color-renamed"],
      ["Base", "--git-panel-conflict-base"],
      ["Modified", "--syntax-color-modified"],
    ]) {
      container.innerHTML = `<lumine-text-editor><div class="git-panel-Conflict${side}Block"><button class="btn">Use changes</button></div></lumine-text-editor>`;
      const button = container.querySelector("button");
      for (const [background, foreground] of [
        ["#eeeeee", 0],
        ["#111111", 255],
      ]) {
        container.style.setProperty(variable, background);
        context.fillStyle = getComputedStyle(button).color;
        context.fillRect(0, 0, 1, 1);
        expect(Array.from(context.getImageData(0, 0, 1, 1).data)).toEqual([
          foreground,
          foreground,
          foreground,
          255,
        ]);
      }
    }
  });

  it("colors the Git loading mark and its ring from the current theme accent", () => {
    container.innerHTML =
      '<div class="git-panel-Loader"><span class="git-panel-Spinner"></span></div>';
    const spinner = container.querySelector(".git-panel-Spinner");
    const mark = () => getComputedStyle(spinner, "::before");
    const ring = () => getComputedStyle(spinner, "::after");

    expect(mark().maskImage).toContain("/img/git.svg");
    expect(mark().backgroundColor).toBe("rgb(10, 20, 30)");
    expect(ring().borderRightColor).toBe("rgb(10, 20, 30)");

    container.style.setProperty("--accent-indicator-color", "rgb(80, 100, 120)");
    expect(mark().backgroundColor).toBe("rgb(80, 100, 120)");
    expect(ring().borderRightColor).toBe("rgb(80, 100, 120)");
  });

  it("loads the Git logo through the running package's asset protocol", async () => {
    container.innerHTML =
      '<div class="git-panel-Loader"><span class="git-panel-Spinner"></span></div>';
    const spinner = container.querySelector(".git-panel-Spinner");
    const mask = getComputedStyle(spinner, "::before").maskImage;
    const url = mask.match(/^url\("(.+)"\)$/)[1];
    const image = new Image();
    image.src = url;

    const [response] = await Promise.all([fetch(url), image.decode()]);

    expect(response.ok).toBe(true);
    expect(image.naturalWidth).toBeGreaterThan(0);
    expect(image.naturalHeight).toBeGreaterThan(0);
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
    container.innerHTML = '<span class="git-panel-FilePatchView-metaDiff--added">Added</span>';
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
