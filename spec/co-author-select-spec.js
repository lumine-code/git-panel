/** @babel */
import path from "path";
import CoAuthorSelect from "../lib/views/co-author-select";
import CoAuthorForm from "../lib/views/co-author-form";
import CommitView from "../lib/views/commit-view";
import Author from "../lib/models/author";
import { flushViews } from "./helpers/etch";

describe("the native co-author picker", () => {
  let picker;
  const authors = [
    new Author("ada@example.com", "Ada Lovelace"),
    new Author("grace@example.com", "Grace Hopper"),
  ];

  afterEach(async () => {
    await picker?.destroy();
    picker = null;
  });

  function createPicker(options = {}) {
    picker = new CoAuthorSelect({ options: authors, value: [], ...options });
    jasmine.attachToDOM(picker.element);
    return picker;
  }

  it("filters by name and email, selects with the keyboard, and removes the last chip", async () => {
    const onChange = jasmine.createSpy("selected authors");
    createPicker({ onChange });
    const input = picker.element.querySelector("input");
    input.value = "grace@";
    await flushViews(() => input.dispatchEvent(new Event("input", { bubbles: true })));
    expect(picker.getOptions().map((author) => author.getEmail())).toEqual([
      "grace@example.com",
      "Add new author",
    ]);
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    await flushViews(() => picker.handleKey(13));
    expect(onChange).toHaveBeenCalledOnceWith([authors[1]]);
    await flushViews(() => picker.update({ options: authors, value: [authors[1]], onChange }));
    await flushViews(() => picker.handleKey(8));
    expect(onChange.calls.mostRecent().args[0]).toEqual([]);
  });

  it("passes the typed new author's name to the author form", async () => {
    const onChange = jasmine.createSpy("new author");
    createPicker({ onChange });
    await flushViews(() => picker.updateState({ search: "New Person", open: true, focused: 0 }));
    expect(picker.getOptions().length).toBe(1);
    await flushViews(() => picker.handleKey(13));
    const [author] = onChange.calls.mostRecent().args[0];
    expect(author.isNew()).toBe(true);
    expect(author.getFullName()).toBe("New Person");
  });

  it("opens a scrollable author menu without resizing the commit controls", async () => {
    const stylesheet = lumine.themes.requireStylesheet(
      path.join(__dirname, "..", "styles", "main.css"),
    );
    const options = Array.from(
      { length: 80 },
      (_, index) => new Author(`author-${index}@example.com`, `Author ${index}`),
    );
    createPicker({ className: "git-panel-CommitView-coAuthorEditor", options });
    picker.element.style.width = "300px";
    const closedHeight = picker.element.getBoundingClientRect().height;
    try {
      await flushViews(() => picker.updateState({ open: true }));
      const menu = picker.element.querySelector('[role="listbox"]');
      expect(picker.element.getBoundingClientRect().height).toBe(closedHeight);
      expect(menu.clientHeight).toBeGreaterThan(0);
      expect(menu.scrollHeight).toBeGreaterThan(menu.clientHeight);
      await flushViews(() => picker.handleKey(35));
      expect(menu.scrollTop).toBeGreaterThan(0);
      expect(picker.refs.input.getAttribute("aria-activedescendant")).toBe(picker.refs.focused.id);
    } finally {
      stylesheet.dispose();
    }
  });

  it("routes the focused author to the exclusion command and releases unused keys", async () => {
    const config = { get: () => "previous@example.com", set: jasmine.createSpy("exclude user") };
    const commit = Object.create(CommitView.prototype);
    commit.props = { config };
    createPicker({
      onFocusedAuthor: (author) => {
        commit.focusedCoAuthor = author;
      },
    });
    await flushViews(() => picker.handleKey(40));
    await flushViews(() => picker.handleKey(40));
    commit.excludeCoAuthor();
    expect(config.set).toHaveBeenCalledOnceWith(
      "git-panel.excludedUsers",
      "previous@example.com, grace@example.com",
    );
    await flushViews(() => picker.handleKey(27));
    const event = { abortKeyBinding: jasmine.createSpy("allow native input") };
    expect(picker.handleKey(46, event)).toBe(false);
    expect(event.abortKeyBinding).toHaveBeenCalled();
  });

  it("keeps valid form state consistent when an email becomes invalid again", async () => {
    const form = new CoAuthorForm({ name: "New Person", commands: lumine.commands });
    jasmine.attachToDOM(form.element);
    try {
      const input = form.element.querySelector('input[type="email"]');
      input.value = "person@example.com";
      await flushViews(() => input.dispatchEvent(new Event("input", { bubbles: true })));
      expect(form.state.submitDisabled).toBe(false);
      input.value = "invalid";
      await flushViews(() => input.dispatchEvent(new Event("input", { bubbles: true })));
      expect(form.state.submitDisabled).toBe(true);
      expect(form.element.querySelector(".btn-primary").disabled).toBe(true);
    } finally {
      await form.destroy();
    }
  });
});
