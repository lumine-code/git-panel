const { Disposable } = require("lumine");

let current = null;
const waiters = new Set();

function getPatchView() {
  return current;
}
function requirePatchView() {
  if (!current) throw new Error("The patch-view service is inactive.");
  return current;
}
function whenPatchView() {
  if (current) return Promise.resolve(current);
  return new Promise((resolve, reject) => waiters.add({ resolve, reject }));
}
function cancelPatchViewWaiters(error) {
  for (const waiter of waiters) waiter.reject(error);
  waiters.clear();
}
function consumePatchView(service, onChange = () => {}) {
  current = service;
  for (const waiter of waiters) waiter.resolve(service);
  waiters.clear();
  onChange(service);
  return new Disposable(() => {
    if (current !== service) return;
    current = null;
    onChange(null);
  });
}

// The panel owns editable repository state; the provider owns every patch
// constructor and view generation. Resolve exports when read, so a replacement
// provider cannot leave a stale class cached in the panel's module graph.
function model(name) {
  return new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "__esModule") return true;
        const exports = requirePatchView().models[name];
        return key === "default" ? exports.default || exports : exports[key];
      },
    },
  );
}
function view(name) {
  return new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "__esModule") return true;
        const exports = requirePatchView().views[name];
        return key === "default" ? exports.default || exports : exports[key];
      },
    },
  );
}

module.exports = {
  consumePatchView,
  getPatchView,
  requirePatchView,
  whenPatchView,
  cancelPatchViewWaiters,
  model,
  view,
};
