const { Disposable } = require("lumine");

// Bridges the `linter.editors` service to the editors this package wants
// linted — today the commit message box. The service connects whenever the
// linter package activates, before or after any editor here is built, so
// registrations made early are kept and replayed when it arrives.

const registered = new Map(); // editor -> Disposable, or null while unconnected
let register = null;
const providers = new Map();

function selectProvider() {
  const next = [...providers.values()].at(-1) ?? null;
  if (next === register) return;
  register = next;
  for (const [editor, disposable] of registered) {
    disposable?.dispose();
    registered.set(editor, register ? register(editor) : null);
  }
}

exports.consumeLinterEditors = function consumeLinterEditors(service) {
  const token = {};
  providers.set(token, service);
  selectProvider();
  return new Disposable(() => {
    providers.delete(token);
    selectProvider();
  });
};

exports.addLinterEditor = function addLinterEditor(editor) {
  registered.set(editor, register ? register(editor) : null);
  return new Disposable(() => {
    registered.get(editor)?.dispose();
    registered.delete(editor);
  });
};
