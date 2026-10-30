/** @babel */
import Avatar, { FALLBACK_AVATAR } from "../lib/views/avatar.js";
import GitTabHeaderView from "../lib/views/git-tab-header-view.js";
import { RecentCommitView } from "../lib/views/recent-commits-view.js";
import CommitDetailHeaderView from "../lib/views/commit-detail-header-view.js";
import { createViewHost, createViewModel, flushViews } from "./helpers/etch.js";

const corruptImage = "data:image/png;base64,AAAA";
const validImage =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><path fill="red" d="M0 0h2v2H0z"/></svg>',
  );

async function untilLoaded(image, expectedSource) {
  const deadline = Date.now() + 2000;
  while (image.getAttribute("src") !== expectedSource || !image.complete || !image.naturalWidth) {
    if (Date.now() >= deadline)
      throw new Error(`Avatar did not decode: ${image.getAttribute("src")}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("Git author avatars", () => {
  let views, containers;

  beforeEach(() => {
    jasmine.useRealClock();
    views = [];
    containers = [];
  });

  afterEach(async () => {
    for (const view of views.reverse()) await view.destroy();
    for (const container of containers) container.remove();
  });

  function avatar(props = {}) {
    const view = new Avatar({ title: "Author", alt: "Author's avatar", ...props });
    views.push(view);
    jasmine.attachToDOM(view.element);
    return view;
  }

  it("decodes the bundled avatar when an author has no image URL", async () => {
    const view = avatar();
    await untilLoaded(view.element, FALLBACK_AVATAR);
    expect(view.element.getAttribute("alt")).toBe("Author's avatar");
  });

  it("loads the local avatar after an actual browser image failure", async () => {
    const view = avatar({ src: corruptImage });
    await untilLoaded(view.element, FALLBACK_AVATAR);
    expect(view.element.naturalWidth).toBeGreaterThan(0);
  });

  it("keeps a successfully decoded author image", async () => {
    const view = avatar({ src: validImage });
    await untilLoaded(view.element, validImage);
    expect(view.element.naturalWidth).toBe(2);
  });

  it("retains a failed author's fallback across unrelated parent updates", async () => {
    const view = avatar({ src: corruptImage });
    await untilLoaded(view.element, FALLBACK_AVATAR);
    await flushViews(() => view.update({ ...view.props, title: "Updated author" }));
    expect(view.element.getAttribute("src")).toBe(FALLBACK_AVATAR);
    expect(view.element.title).toBe("Updated author");
  });

  it("retries a new author URL and ignores the retired request's error callback", async () => {
    const view = avatar({ src: corruptImage });
    const retiredError = view.render().props.onError;
    await untilLoaded(view.element, FALLBACK_AVATAR);
    await flushViews(() => view.update({ ...view.props, src: validImage }));
    retiredError();
    await untilLoaded(view.element, validImage);
    expect(view.element.naturalWidth).toBe(2);
  });

  it("does not retry a failing bundled fallback", async () => {
    const view = avatar();
    const update = spyOn(view, "updateState").and.callThrough();
    view.element.dispatchEvent(new Event("error"));
    view.element.dispatchEvent(new Event("error"));
    await flushViews(async () => {});
    expect(update).not.toHaveBeenCalled();
  });

  it("ignores a queued image error after the view is destroyed", async () => {
    const view = avatar({ src: validImage });
    const retiredError = view.render().props.onError;
    await view.destroy();
    const update = spyOn(view, "updateState").and.callThrough();
    retiredError();
    expect(update).not.toHaveBeenCalled();
  });

  const surfaces = [
    ["repository header", GitTabHeaderView, (view) => view.renderCommitter()],
    ["recent commit", RecentCommitView, (view, author) => view.renderAuthor(author)],
    ["commit detail", CommitDetailHeaderView, (view, author) => view.renderAuthor(author)],
  ];
  for (const [name, Type, render] of surfaces) {
    it(`uses the same decoded fallback in the ${name} avatar`, async () => {
      const author = {
        getEmail: () => "author@example.invalid",
        getFullName: () => "Author",
        getAvatarUrl: () => corruptImage,
      };
      const model = createViewModel(Type, { committer: author });
      views.push(model);
      const container = document.createElement("div");
      containers.push(container);
      jasmine.attachToDOM(container);
      const host = createViewHost(container);
      views.push(host);
      await flushViews(() => host.update(render(model, author)));
      const image = container.querySelector("img");
      expect(image).not.toBeNull();
      await untilLoaded(image, FALLBACK_AVATAR);
      expect(image.title).toContain("author@example.invalid");
    });
  }
});
