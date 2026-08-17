/** @babel */
import { consumeAutocompleteWatchEditor, addAutocompleteEditor } from "../lib/autocomplete-editors";

// The commit box is not a pane item, so autocomplete never watches it on its
// own; this holder hands it over through the `autocomplete.watch-editor`
// service. Editors and the service arrive in either order, and each side can
// go away first.
describe("lib/autocomplete-editors", () => {
  let registrations;
  let serviceDisposable;

  const watch = (editor, labels) => {
    const entry = { editor, labels, disposed: false };
    registrations.push(entry);
    return {
      dispose() {
        entry.disposed = true;
      },
    };
  };

  const buildEditor = () => lumine.workspace.buildTextEditor();

  beforeEach(() => {
    registrations = [];
    serviceDisposable = null;
  });

  afterEach(() => {
    serviceDisposable?.dispose();
  });

  it("watches an editor added after the service connected", () => {
    serviceDisposable = consumeAutocompleteWatchEditor(watch);
    const editor = buildEditor();

    const added = addAutocompleteEditor(editor);

    expect(registrations.map((entry) => entry.editor)).toEqual([editor]);
    expect(registrations[0].labels).toContain("default");
    added.dispose();
    expect(registrations[0].disposed).toBe(true);
    editor.destroy();
  });

  it("replays an editor added before the service connected", () => {
    const editor = buildEditor();
    const added = addAutocompleteEditor(editor);
    expect(registrations).toEqual([]);

    serviceDisposable = consumeAutocompleteWatchEditor(watch);

    expect(registrations.map((entry) => entry.editor)).toEqual([editor]);
    added.dispose();
    editor.destroy();
  });

  it("drops its registrations when the service goes away, and replays on return", () => {
    serviceDisposable = consumeAutocompleteWatchEditor(watch);
    const editor = buildEditor();
    const added = addAutocompleteEditor(editor);

    serviceDisposable.dispose();
    expect(registrations[0].disposed).toBe(true);

    serviceDisposable = consumeAutocompleteWatchEditor(watch);
    expect(registrations.length).toBe(2);
    expect(registrations[1].editor).toBe(editor);
    expect(registrations[1].disposed).toBe(false);

    added.dispose();
    editor.destroy();
  });
});
