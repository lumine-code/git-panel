const { Disposable } = require("lumine");

// Bridges the `autocomplete.watch-editor` service to the editors this package
// wants completions in — today the commit message box. The service connects
// whenever the autocomplete package activates, before or after any editor here
// is built, so registrations made early are kept and replayed when it arrives.

// `default` admits the providers that opt into any watched editor — buffer
// words — without pulling in the workspace-center-only ones; the second label
// is the hook a provider aimed specifically at commit messages would declare.
const LABELS = ["default", "git-panel-commit-message"];

const registered = new Map(); // editor -> Disposable, or null while unconnected
let watch = null;
const providers = new Map();

function selectProvider() {
  const next = [...providers.values()].at(-1) ?? null;
  if (next === watch) return;
  watch = next;
  for (const [editor, disposable] of registered) {
    disposable?.dispose();
    registered.set(editor, watch ? watch(editor, LABELS) : null);
  }
}

exports.consumeAutocompleteWatchEditor = function consumeAutocompleteWatchEditor(service) {
  const token = {};
  providers.set(token, service);
  selectProvider();
  return new Disposable(() => {
    providers.delete(token);
    selectProvider();
  });
};

exports.addAutocompleteEditor = function addAutocompleteEditor(editor) {
  registered.set(editor, watch ? watch(editor, LABELS) : null);
  return new Disposable(() => {
    registered.get(editor)?.dispose();
    registered.delete(editor);
  });
};
