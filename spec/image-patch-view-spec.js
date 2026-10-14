/** @babel */
import ImagePatchView from "../lib/views/image-patch-view.js";
import PatchDocument from "../lib/models/patch-document.js";
import { buildFilePatch } from "../lib/models/patch/index.js";
import { hasImagePatch } from "../lib/image-patch.js";
import { flushViews } from "./helpers/etch.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=",
  "base64",
);

describe("old and new image previews", () => {
  let view, repository, createURL, revokeURL;
  const patches = [];
  const workdir = import.meta.dirname;

  function file(overrides = {}) {
    const patch = buildFilePatch([
      {
        oldPath: "image.png",
        newPath: "image.png",
        oldMode: "100644",
        newMode: "100644",
        status: "modified",
        binary: true,
        hunks: [],
        ...overrides,
      },
    ]);
    patches.push(patch);
    return patch.getFilePatches()[0];
  }

  function mount(
    filePatch = file(),
    document = PatchDocument.file(workdir, "image.png", "unstaged"),
    extra = {},
  ) {
    view = new ImagePatchView({
      repository,
      filePatch,
      document,
      layout: "side-by-side",
      ...extra,
    });
    jasmine.attachToDOM(view.element);
    return flushViews(() => view.loading);
  }

  beforeEach(() => {
    repository = { readFileAtEndpoint: jasmine.createSpy("read image bytes").and.resolveTo(png) };
    createURL = spyOn(URL, "createObjectURL").and.callThrough();
    revokeURL = spyOn(URL, "revokeObjectURL").and.callThrough();
  });

  afterEach(async () => {
    await view?.destroy();
    view = null;
    while (patches.length) patches.pop().dispose();
  });

  function endpoints() {
    return repository.readFileAtEndpoint.calls
      .allArgs()
      .map(([name, endpoint]) => [name, endpoint]);
  }

  it("reads unstaged images from the index and worktree and decodes both actual PNGs", async () => {
    await mount();
    expect(endpoints()).toEqual([
      ["image.png", { type: "index" }],
      ["image.png", { type: "worktree" }],
    ]);
    const images = Array.from(view.element.querySelectorAll("img"));
    expect(images.length).toBe(2);
    await Promise.all(images.map((image) => image.decode()));
    await flushViews(async () => {});
    for (const image of images) {
      expect(image.naturalWidth).toBe(1);
      expect(image.naturalHeight).toBe(1);
    }
    expect(view.element.textContent).toContain("1 × 1");
    expect(view.element.querySelector('[data-side="old"]').textContent).toContain("Index");
    expect(view.element.querySelector('[data-side="new"]').textContent).toContain("Working Tree");
  });

  it("reads staged images from HEAD and the index without using the worktree", async () => {
    await mount(file(), PatchDocument.staged(workdir));
    expect(endpoints()).toEqual([
      ["image.png", { type: "commit", revision: "HEAD" }],
      ["image.png", { type: "index" }],
    ]);
  });

  it("uses the resolved commit and its first parent instead of a moving revision alias", async () => {
    await mount(file(), PatchDocument.commit(workdir, "HEAD"), {
      commit: { getSha: () => "abc123" },
    });
    expect(endpoints()).toEqual([
      ["image.png", { type: "commit", revision: "abc123^1" }],
      ["image.png", { type: "commit", revision: "abc123" }],
    ]);
  });

  it("does not read an absent old file for a root commit or unborn staged addition", async () => {
    for (const document of [
      PatchDocument.commit(workdir, "abc123"),
      PatchDocument.staged(workdir),
    ]) {
      repository.readFileAtEndpoint.calls.reset();
      await mount(file({ oldPath: null, oldMode: null, status: "added" }), document);
      expect(repository.readFileAtEndpoint.calls.count()).toBe(1);
      expect(view.element.querySelector('[data-side="old"]').textContent).toContain("File absent");
      expect(view.element.querySelectorAll("img").length).toBe(1);
      await view.destroy();
    }
  });

  it("shows only the old image for deletions", async () => {
    await mount(file({ newPath: null, newMode: null, status: "deleted" }));
    expect(endpoints()).toEqual([["image.png", { type: "index" }]]);
    expect(view.element.querySelector('[data-side="new"]').textContent).toContain("File absent");
  });

  it("reads each rename path and handles uppercase image extensions", async () => {
    await mount(file({ oldPath: "before.PNG", newPath: "after.JPG", status: "renamed" }));
    expect(endpoints()).toEqual([
      ["before.PNG", { type: "index" }],
      ["after.JPG", { type: "worktree" }],
    ]);
    expect(createURL.calls.argsFor(0)[0].type).toBe("image/png");
    expect(createURL.calls.argsFor(1)[0].type).toBe("image/jpeg");
  });

  it("skips symlink contents and non-image sides of a type or extension change", async () => {
    const link = file({ oldMode: "120000", oldPath: "outside.png" });
    expect(hasImagePatch(link)).toBeTrue();
    await mount(link);
    expect(endpoints()).toEqual([["image.png", { type: "worktree" }]]);
    expect(view.element.querySelector('[data-side="old"]').textContent).toContain(
      "not a supported image",
    );
    expect(hasImagePatch(file({ oldMode: "160000", newMode: "120000" }))).toBeFalse();
    expect(hasImagePatch(file({ oldPath: "file.txt", newPath: "file.pdf" }))).toBeFalse();
  });

  it("refreshes a changed image even when its text diff remains empty and revokes old URLs", async () => {
    await mount();
    const previousURLs = Array.from(view.urls);
    const previousSignal = repository.readFileAtEndpoint.calls.first().args[2].signal;
    const nextFile = file();
    await flushViews(() => view.update({ ...view.props, filePatch: nextFile }));
    await flushViews(() => view.loading);
    expect(repository.readFileAtEndpoint.calls.count()).toBe(4);
    expect(previousSignal.aborted).toBeTrue();
    for (const url of previousURLs) expect(revokeURL).toHaveBeenCalledWith(url);
    expect(Array.from(view.urls).some((url) => previousURLs.includes(url))).toBeFalse();
  });

  it("ignores late reads after a document and repository replacement", async () => {
    const complete = [];
    repository.readFileAtEndpoint.and.callFake(
      () => new Promise((resolve) => complete.push(resolve)),
    );
    view = new ImagePatchView({
      repository,
      filePatch: file(),
      document: PatchDocument.file(workdir, "image.png", "unstaged"),
    });
    const previousLoad = view.loading;
    const previousSignal = repository.readFileAtEndpoint.calls.first().args[2].signal;
    const replacement = { readFileAtEndpoint: jasmine.createSpy().and.resolveTo(png) };
    await flushViews(() =>
      view.update({
        repository: replacement,
        filePatch: file(),
        document: PatchDocument.staged(workdir),
      }),
    );
    await flushViews(() => view.loading);
    expect(previousSignal.aborted).toBeTrue();
    for (const resolve of complete) resolve(png);
    await previousLoad;
    expect(createURL.calls.count()).toBe(2);
    expect(view.element.querySelectorAll("img").length).toBe(2);
  });

  it("aborts pending reads on destruction and never allocates URLs for late results", async () => {
    const complete = [];
    repository.readFileAtEndpoint.and.callFake(
      () => new Promise((resolve) => complete.push(resolve)),
    );
    view = new ImagePatchView({
      repository,
      filePatch: file(),
      document: PatchDocument.file(workdir, "image.png", "unstaged"),
    });
    const signal = repository.readFileAtEndpoint.calls.first().args[2].signal;
    const loading = view.loading;
    await view.destroy();
    for (const resolve of complete) resolve(png);
    await loading;
    expect(signal.aborted).toBeTrue();
    expect(createURL).not.toHaveBeenCalled();
  });

  it("keeps the available side visible when the other read fails or disappears", async () => {
    repository.readFileAtEndpoint.and.callFake((name, endpoint) =>
      endpoint.type === "index" ? Promise.reject(new Error("Read failed")) : Promise.resolve(png),
    );
    await mount();
    expect(view.element.querySelector('[data-side="old"]').textContent).toContain(
      "Unable to preview image",
    );
    expect(view.element.querySelectorAll("img").length).toBe(1);
    repository.readFileAtEndpoint.and.callFake((name, endpoint) =>
      Promise.resolve(endpoint.type === "index" ? null : png),
    );
    await flushViews(() => view.update({ ...view.props, filePatch: file() }));
    await flushViews(() => view.loading);
    expect(view.element.querySelector('[data-side="old"]').textContent).toContain(
      "Image unavailable",
    );
    expect(view.element.querySelectorAll("img").length).toBe(1);
  });

  it("handles decode failures and releases all successful URLs when closed", async () => {
    await mount();
    const [oldURL, newURL] = Array.from(view.urls);
    const oldImage = view.element.querySelector('[data-side="old"] img');
    await flushViews(() => oldImage.dispatchEvent(new Event("error")));
    expect(revokeURL).toHaveBeenCalledWith(oldURL);
    expect(view.element.querySelector('[data-side="old"]').textContent).toContain(
      "Unable to preview image",
    );
    await view.destroy();
    expect(revokeURL).toHaveBeenCalledWith(newURL);
    expect(view.urls.size).toBe(0);
  });

  it("uses one image stage with a focusable, labelled divider in unified", async () => {
    await mount(file(), undefined, { layout: "unified" });
    expect(view.element.querySelectorAll("figure").length).toBe(0);
    expect(view.element.querySelectorAll(".git-panel-ImagePatchView-stage").length).toBe(1);
    expect(view.element.querySelectorAll("img").length).toBe(2);
    const slider = view.element.querySelector('[role="slider"]');
    expect(slider.getAttribute("aria-label")).toBe("Old and new image boundary");
    expect([
      slider.getAttribute("aria-valuemin"),
      slider.getAttribute("aria-valuemax"),
      slider.getAttribute("aria-valuenow"),
      slider.getAttribute("tabindex"),
    ]).toEqual(["0", "100", "50", "0"]);
    expect(view.element.querySelector('input[type="range"]')).toBeNull();
    const oldLayer = view.element.querySelector(".git-panel-ImagePatchView-oldLayer");
    expect(oldLayer.style.clipPath).toBe("inset(0px 50% 0px 0px)");
    for (const [key, position] of [
      ["Home", 0],
      ["PageUp", 10],
      ["End", 100],
    ]) {
      await flushViews(() =>
        slider.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
        ),
      );
      expect(view.state.position).toBe(position);
      expect(slider.getAttribute("aria-valuetext")).toBe(
        `${position}% old, ${100 - position}% new`,
      );
      expect(oldLayer.style.clipPath).toBe(`inset(0px ${100 - position}% 0px 0px)`);
      expect(view.element.querySelector(".git-panel-ImagePatchView-divider").style.left).toBe(
        `${position}%`,
      );
    }
    await flushViews(() => view.setPosition(49.5));
    expect(slider.getAttribute("aria-valuetext")).toBe("50% old, 50% new");
  });

  it("can change layouts while preserving decoded bytes and the chosen boundary", async () => {
    await mount(file(), undefined, { layout: "unified" });
    const urls = Array.from(view.urls);
    await flushViews(() => view.setPosition(30));
    await flushViews(() => view.update({ ...view.props, layout: "side-by-side" }));
    expect(view.element.querySelectorAll("figure").length).toBe(2);
    expect(view.element.querySelector('[role="slider"]')).toBeNull();
    await flushViews(() => view.update({ ...view.props, layout: "unified" }));
    expect(view.element.querySelector('[role="slider"]').getAttribute("aria-valuenow")).toBe("30");
    expect(repository.readFileAtEndpoint.calls.count()).toBe(2);
    expect(Array.from(view.urls)).toEqual(urls);
  });

  it("preserves the chosen unified boundary when the same image refreshes", async () => {
    await mount(file(), undefined, { layout: "unified" });
    await flushViews(() => view.setPosition(73));
    await flushViews(() => view.update({ ...view.props, filePatch: file() }));
    await flushViews(() => view.loading);
    expect(view.element.querySelector('[role="slider"]').getAttribute("aria-valuenow")).toBe("73");
    expect(repository.readFileAtEndpoint.calls.count()).toBe(4);
  });

  it("releases captured dragging when a layout update removes the divider", async () => {
    await mount(file(), undefined, { layout: "unified" });
    const handle = view.element.querySelector('[role="slider"]');
    const bounds = view.element
      .querySelector(".git-panel-ImagePatchView-stage")
      .getBoundingClientRect();
    let captured = false;
    spyOn(handle, "setPointerCapture").and.callFake(() => {
      captured = true;
    });
    spyOn(handle, "hasPointerCapture").and.callFake(() => captured);
    const release = spyOn(handle, "releasePointerCapture").and.callFake(() => {
      captured = false;
    });
    await flushViews(() =>
      handle.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 4,
          button: 0,
          clientX: bounds.left + bounds.width / 2,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(captured).toBeTrue();
    await flushViews(() => view.update({ ...view.props, layout: "side-by-side" }));
    expect(release).toHaveBeenCalledWith(4);
    expect(view.dragPointerId).toBeNull();
    await flushViews(() => view.update({ ...view.props, layout: "unified" }));
    const nextHandle = view.element.querySelector('[role="slider"]');
    await flushViews(() =>
      nextHandle.dispatchEvent(
        new PointerEvent("pointermove", { pointerId: 4, clientX: bounds.right, bubbles: true }),
      ),
    );
    expect(view.state.position).toBe(50);
  });

  it("shows the single existing image for unified additions and deletions", async () => {
    for (const overrides of [
      { oldPath: null, oldMode: null, status: "added" },
      { newPath: null, newMode: null, status: "deleted" },
    ]) {
      await mount(file(overrides), undefined, { layout: "unified" });
      expect(view.element.querySelectorAll("img").length).toBe(1);
      expect(view.element.querySelectorAll("figure").length).toBe(1);
      expect(view.element.querySelector('[role="slider"]')).toBeNull();
      expect(view.element.textContent).toContain("File absent in this version");
      await view.destroy();
    }
  });

  it("releases a corrupt image's URL before showing the available unified side", async () => {
    repository.readFileAtEndpoint.and.callFake((name, endpoint) =>
      Promise.resolve(endpoint.type === "index" ? Buffer.from("not a valid PNG") : png),
    );
    await mount(file(), undefined, { layout: "unified" });
    expect(view.element.querySelector('[role="slider"]')).toBeNull();
    expect(view.element.querySelectorAll("img").length).toBe(1);
    expect(view.element.textContent).toContain("Old: Unable to preview image");
    expect(view.urls.size).toBe(1);
    expect(revokeURL.calls.count()).toBe(1);
  });
});
