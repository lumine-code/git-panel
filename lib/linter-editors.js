/** @babel */

import { Disposable } from "lumine";

// Bridges the `linter.editors` service to the editors this package wants
// linted — today the commit message box. The service connects whenever the
// linter package activates, before or after any editor here is built, so
// registrations made early are kept and replayed when it arrives.

const registered = new Map(); // editor -> Disposable, or null while unconnected
let register = null;

export function consumeLinterEditors(service) {
  register = service;
  for (const [editor, disposable] of registered) {
    if (disposable === null) {
      registered.set(editor, register(editor));
    }
  }
  return new Disposable(() => {
    register = null;
    for (const [editor, disposable] of registered) {
      disposable?.dispose();
      registered.set(editor, null);
    }
  });
}

export function addLinterEditor(editor) {
  registered.set(editor, register ? register(editor) : null);
  return new Disposable(() => {
    registered.get(editor)?.dispose();
    registered.delete(editor);
  });
}
