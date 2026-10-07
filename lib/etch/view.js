/** @babel */
import etch from "@lumine-code/etch";

export const Fragment = etch.dom.Fragment;
const transactionDepth = Symbol.for("lumine.native-view.transaction-depth");

// Functions passed to a view are render callbacks, not DOM children.
export function h(tag, props, ...children) {
  if (typeof tag === "function" && children.length === 1 && typeof children[0] === "function") {
    return etch.dom(tag, { ...props, children: children[0] });
  }
  return etch.dom(tag, props, ...children.map(normalizeChild));
}

function normalizeChild(child) {
  return Array.isArray(child) ? child.map(normalizeChild) : (child ?? null);
}

export function transaction(callback) {
  lumine.views[transactionDepth] = (lumine.views[transactionDepth] || 0) + 1;
  try {
    return callback();
  } finally {
    lumine.views[transactionDepth]--;
  }
}

export class View {
  constructor(props = {}, children = []) {
    this.props = this.resolveProps(props, children);
    this.state = {};
    this.mounted = false;
    this.destroyed = false;
    this.initialized = false;
    this.pendingPrevious = null;
    this.pendingCallbacks = [];
    this.destroyPromise = null;
  }

  resolveProps(props, children) {
    const result = { ...this.constructor.defaultProps, ...props };
    delete result.ref;
    delete result.key;
    for (const key in this.constructor.defaultProps) {
      if (result[key] === undefined) result[key] = this.constructor.defaultProps[key];
    }
    if (result.children === undefined) result.children = children;
    return result;
  }

  deriveState() {
    const derive = this.constructor.deriveState;
    if (derive) this.state = { ...this.state, ...derive(this.props, this.state) };
  }

  initialize() {
    if (this.initialized || this.destroyed) return this;
    try {
      this.deriveState();
      etch.initialize(this);
      this.initialized = true;
      this.mounted = true;
      this.didMount?.();
      return this;
    } catch (error) {
      // A later child can fail after an earlier child acquired native resources.
      // The partial tree still owns those children and must release them.
      this.initialized = Boolean(this.virtualNode);
      this.destroy();
      throw error;
    }
  }

  rememberPrevious() {
    if (!this.pendingPrevious) this.pendingPrevious = { props: this.props, state: this.state };
  }

  update(props, children = []) {
    if (this.destroyed) return Promise.resolve();
    this.rememberPrevious();
    this.props = this.resolveProps(props || {}, children);
    this.deriveState();
    return this.invalidate();
  }

  updateState(update, callback) {
    if (this.destroyed) return Promise.resolve();
    const partial = typeof update === "function" ? update(this.state, this.props) : update;
    if (partial == null) {
      callback?.();
      return Promise.resolve();
    }
    this.rememberPrevious();
    this.state = { ...this.state, ...partial };
    this.deriveState();
    return this.invalidate(callback);
  }

  invalidate(callback) {
    if (this.destroyed) return Promise.resolve();
    if (callback) this.pendingCallbacks.push(callback);
    if (!this.initialized) return Promise.resolve();
    this.rememberPrevious();
    if (lumine.views[transactionDepth] > 0) {
      etch.updateSync(this);
      return Promise.resolve();
    }
    const update = etch.update(this);
    // Keep failed fire-and-forget refreshes visible without a global unhandled
    // rejection. Callers awaiting the original promise still receive the error.
    if (this.reportedUpdatePromise !== update) {
      this.reportedUpdatePromise = update;
      update.then(
        () => {
          if (this.reportedUpdatePromise === update) this.reportedUpdatePromise = null;
        },
        (error) => {
          this.pendingCallbacks = [];
          this.pendingPrevious = null;
          if (this.reportedUpdatePromise === update) this.reportedUpdatePromise = null;
          console.error("Native panel update failed", error);
        },
      );
    }
    return update;
  }

  updateSync() {
    if (this.destroyed || !this.initialized) return;
    this.rememberPrevious();
    etch.updateSync(this);
  }

  writeAfterUpdate() {
    if (this.destroyed) return;
    const previous = this.pendingPrevious;
    const callbacks = this.pendingCallbacks;
    this.pendingPrevious = null;
    this.pendingCallbacks = [];
    if (previous) this.didUpdate?.(previous.props, previous.state);
    for (const callback of callbacks) {
      if (this.destroyed) break;
      callback();
    }
  }

  destroy() {
    if (this.destroyed) return this.destroyPromise || Promise.resolve();
    this.destroyed = true;
    this.mounted = false;
    this.pendingCallbacks = [];
    this.pendingPrevious = null;
    if (this.initialized) etch.destroySync(this);
    this.willDestroy?.();
    this.destroyPromise = Promise.resolve();
    return this.destroyPromise;
  }
}

export default View;

export function mount(node, container) {
  class MountedView extends View {
    constructor() {
      super();
      this.node = node;
      this.initialize();
    }

    render() {
      return h("div", { style: { display: "contents" } }, this.node);
    }

    update(nextNode) {
      this.node = nextNode;
      return this.invalidate();
    }
  }
  const view = new MountedView();
  container.appendChild(view.element);
  return view;
}
