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

  it("keeps patch controls on UI surfaces and preview text on its syntax surface", () => {
    container.style.cssText +=
      "; --text-color: rgb(220,230,240); --text-color-highlight: rgb(230,240,250); --base-background-color: rgb(10,20,30); --panel-heading-background-color: rgb(20,30,40); --syntax-background-color: rgb(240,240,240); --syntax-text-color: rgb(30,30,30);";
    container.innerHTML =
      '<div class="git-panel-FilePatchView-header">Header</div><div class="git-panel-FilePatchView-meta">Metadata</div><div class="git-panel-ImagePatchView"><div class="git-panel-ImagePatchView-divider"></div><div class="git-panel-ImagePatchView-preview"><p>No image</p></div></div>';
    const style = (selector, pseudo) => getComputedStyle(container.querySelector(selector), pseudo);
    expect(style(".git-panel-FilePatchView-header").backgroundColor).toBe("rgb(20, 30, 40)");
    expect(style(".git-panel-FilePatchView-header").color).toBe("rgb(220, 230, 240)");
    for (const selector of [".git-panel-FilePatchView-meta", ".git-panel-ImagePatchView"]) {
      expect(style(selector).backgroundColor).toBe("rgb(10, 20, 30)");
      expect(style(selector).color).toBe("rgb(220, 230, 240)");
    }
    expect(style(".git-panel-ImagePatchView-divider", "::after").backgroundColor).toBe(
      "rgb(10, 20, 30)",
    );
    expect(style(".git-panel-ImagePatchView-preview").backgroundColor).toBe("rgb(240, 240, 240)");
    expect(style(".git-panel-ImagePatchView-preview p").color).toBe("rgb(30, 30, 30)");
  });

  it("keeps commit overlay controls and counter subtle on their syntax surface", () => {
    container.style.cssText +=
      "; --syntax-text-color: rgb(220,230,240); --syntax-background-color: rgb(20,30,40); --text-color-subtle: rgb(90,100,110); pointer-events: none;";
    container.innerHTML =
      '<div class="git-panel-CommitView"><div class="git-panel-CommitView-editor"><button class="git-panel-CommitView-hardwrap"><svg class="hard-wrap-icons"></svg></button><button class="git-panel-CommitView-coAuthorToggle"><svg class="git-panel-CommitView-coAuthorToggleIcon"></svg></button><button class="git-panel-CommitView-expandButton">Expand</button><span class="git-panel-CommitView-remaining-characters">72</span></div></div>';
    for (const button of container.querySelectorAll("button")) {
      expect(getComputedStyle(button).opacity).toBe("1");
      expect(getComputedStyle(button).color).toBe("rgb(90, 100, 110)");
      expect(getComputedStyle(button).backgroundColor).toBe("rgb(20, 30, 40)");
    }
    expect(getComputedStyle(container.querySelector(".hard-wrap-icons")).fill).toBe(
      "rgb(90, 100, 110)",
    );
    expect(
      getComputedStyle(container.querySelector(".git-panel-CommitView-coAuthorToggleIcon")).stroke,
    ).toBe("rgb(90, 100, 110)");
    const counter = getComputedStyle(
      container.querySelector(".git-panel-CommitView-remaining-characters"),
    );
    expect(counter.color).toBe("rgb(90, 100, 110)");
    expect(counter.backgroundColor).toBe("rgb(20, 30, 40)");
    container.querySelector(".git-panel-CommitView-editor").classList.add("is-expanded");
    expect(
      getComputedStyle(container.querySelector(".git-panel-CommitView-expandButton")).color,
    ).toBe("rgb(90, 100, 110)");
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
    lumine.packages.loadPackage(path.resolve(__dirname, ".."));
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

  it("keeps a diagnostic character counter on its syntax surface under a mixed theme pair", () => {
    container.style.setProperty("--input-background-color", "rgb(10,20,30)");
    container.style.setProperty("--syntax-background-color", "rgb(230,240,250)");
    container.style.setProperty("--text-color-warning", "rgb(180,190,200)");
    container.innerHTML =
      '<span class="git-panel-CommitView-remaining-characters is-warning">10</span>';
    const counter = getComputedStyle(container.firstElementChild);
    expect(counter.color).toBe("rgb(180, 190, 200)");
    expect(counter.backgroundColor).toBe("rgb(230, 240, 250)");
  });

  it("uses the indicator accent for focus borders and the accent pair for focused commit rows", () => {
    container.innerHTML =
      '<input><button class="git-panel-Dialog--insetButton">Focus</button><div tabindex="0" class="git-panel-RecentCommits"><div class="git-panel-RecentCommit is-selected">Commit</div></div>';
    const button = container.querySelector("button");
    container.querySelector("input").focus();
    button.focus();
    expect(button.matches(":focus-visible")).toBe(true);
    expect(getComputedStyle(button).borderTopColor).toBe("rgb(10, 20, 30)");
    const commits = container.querySelector(".git-panel-RecentCommits");
    commits.focus();
    const selected = getComputedStyle(commits.firstElementChild);
    expect(selected.color).toBe("rgb(230, 240, 250)");
    expect(selected.backgroundColor).toBe("rgb(40, 50, 60)");
  });

  it("shows keyboard focus on details and radio labels without changing their selection", () => {
    container.innerHTML =
      '<input type="text"><details class="git-panel-RemoteConfiguration-details"><summary>Protocol</summary></details><label class="git-panel-RemoteConfiguration-protocolOption"><input type="radio" name="protocol" checked>HTTPS</label><label class="git-panel-Create-visibilityOption"><input type="radio" name="visibility" checked>Public</label>';
    container.querySelector('input[type="text"]').focus();
    const summary = container.querySelector("summary");
    summary.focus();
    expect(summary.matches(":focus-visible")).toBe(true);
    expect(getComputedStyle(summary).borderTopColor).toBe("rgb(10, 20, 30)");
    for (const radio of container.querySelectorAll('input[type="radio"]')) {
      radio.focus();
      expect(radio.matches(":focus-visible")).toBe(true);
      expect(getComputedStyle(radio.parentElement).borderTopColor).toBe("rgb(10, 20, 30)");
      expect(radio.checked).toBe(true);
    }
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
