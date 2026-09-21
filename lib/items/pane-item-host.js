/** @babel */
import { CompositeDisposable, Disposable, Emitter } from "lumine";

let nextKey = 0;

/**
 * Stable pane-item model used while the React view is being mounted.
 *
 * The workspace owns this object for its whole lifetime. React only supplies
 * the view that is delegated to after the pane item has been rendered.
 */
export default class PaneItemHost {
  static create(kind, options = {}) {
    const host = new PaneItemHost(kind, options);

    return new Proxy(host, {
      get(target, property, receiver) {
        if (Reflect.has(target, property)) {
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        }

        const view = target.getHydratedView();
        if (!view || !Reflect.has(view, property)) return undefined;

        const value = view[property];
        return typeof value === "function" ? value.bind(view) : value;
      },

      set(target, property, value, receiver) {
        if (Reflect.has(target, property)) {
          return Reflect.set(target, property, value, receiver);
        }

        const view = target.getHydratedView();
        if (view && Reflect.has(view, property)) {
          view[property] = value;
          return true;
        }

        return Reflect.set(target, property, value, receiver);
      },

      has(target, property) {
        const view = target.getHydratedView();
        return Reflect.has(target, property) || (view != null && Reflect.has(view, property));
      },
    });
  }

  constructor(kind, options = {}) {
    this.kind = kind;
    this.key = ++nextKey;
    this.uri = options.uri || "";
    this.fallbackTitle = options.title || null;
    this.fallbackIconName = options.iconName || null;
    this.defaultLocation = options.defaultLocation || "center";
    this.allowedLocations = Object.freeze(
      Array.from(options.allowedLocations || [this.defaultLocation]),
    );
    this.hydrationProps = options.hydrationProps || {};
    this.serializeFallback = options.serializeFallback;
    this.copyFactory = null;

    this.element = document.createElement("div");
    const classPrefix = options.classPrefix || "git-panel";
    this.element.classList.add(`${classPrefix}-PaneItemHost-${kind}`);

    this.emitter = new Emitter();
    this.viewSubscriptions = new CompositeDisposable();
    this.embeddedObservers = new Set();
    this.pendingStateTerminated = false;
    this.state = "pending";
    this.view = null;
    this.hydrationPromise = new Promise((resolve) => {
      this.resolveHydration = resolve;
    });
  }

  getHydrationState() {
    return this.state;
  }

  isHydrated() {
    return this.state === "hydrated";
  }

  isDestroyed() {
    return this.state === "destroyed";
  }

  hydrate(view) {
    if (!view) throw new TypeError("PaneItemHost.hydrate requires a React view");

    if (this.state === "destroyed") {
      view.destroy?.();
      return false;
    }

    if (this.state === "hydrated") {
      if (view === this.view) return false;
      throw new Error(`Pane item '${this.kind}' was hydrated more than once`);
    }

    this.view = view;
    this.state = "hydrated";
    this.resolveHydration(view);
    this.subscribeToView(view);
    this.emitter.emit("did-hydrate", view);
    this.emitter.emit("did-change-title");
    this.emitter.emit("did-change-icon");
    return true;
  }

  subscribeToView(view) {
    if (typeof view.onDidChangeTitle === "function") {
      this.addViewSubscription(
        view.onDidChangeTitle((...args) => this.emitter.emit("did-change-title", ...args)),
      );
    }

    if (typeof view.onDidChangeIcon === "function") {
      this.addViewSubscription(
        view.onDidChangeIcon((...args) => this.emitter.emit("did-change-icon", ...args)),
      );
    }

    if (typeof view.onDidDestroy === "function") {
      this.addViewSubscription(view.onDidDestroy(() => this.destroyFromView()));
    }

    if (typeof view.onDidTerminatePendingState === "function") {
      this.addViewSubscription(
        view.onDidTerminatePendingState(() => this.didTerminatePendingState()),
      );
    }

    for (const observer of this.embeddedObservers) {
      observer.subscription = this.observeViewEmbeddedTextEditor(view, observer.callback);
    }
  }

  addViewSubscription(subscription) {
    if (subscription && typeof subscription.dispose === "function") {
      this.viewSubscriptions.add(subscription);
    }
  }

  observeViewEmbeddedTextEditor(view, callback) {
    if (typeof view.observeEmbeddedTextEditor !== "function") return null;
    const subscription = view.observeEmbeddedTextEditor(callback);
    return subscription && typeof subscription.dispose === "function" ? subscription : null;
  }

  getHydratedView() {
    return this.state === "hydrated" ? this.view : null;
  }

  whenHydrated() {
    return this.hydrationPromise;
  }

  // Compatibility aliases for package integrations that still use the old
  // terminology while they migrate to getHydratedView()/whenHydrated().
  getRealItem() {
    return this.getHydratedView();
  }

  getRealItemPromise() {
    return this.whenHydrated();
  }

  getHydrationProps() {
    return this.hydrationProps;
  }

  setCopyFactory(copyFactory) {
    this.copyFactory = copyFactory;
  }

  copy(...args) {
    return this.copyFactory ? this.copyFactory(...args) : null;
  }

  getElement() {
    return this.element;
  }

  getURI() {
    return this.uri;
  }

  getTitle() {
    return this.view?.getTitle?.() ?? this.fallbackTitle;
  }

  getIconName() {
    return this.view?.getIconName?.() ?? this.fallbackIconName;
  }

  getDefaultLocation() {
    return this.defaultLocation;
  }

  getAllowedLocations() {
    return this.allowedLocations;
  }

  getPreferredWidth() {
    return this.view?.getPreferredWidth?.();
  }

  getPreferredHeight() {
    return this.view?.getPreferredHeight?.();
  }

  serialize() {
    if (this.view && typeof this.view.serialize === "function") {
      return this.view.serialize();
    }

    if (typeof this.serializeFallback === "function") {
      return this.serializeFallback();
    }

    return this.serializeFallback ?? null;
  }

  observeEmbeddedTextEditor(callback) {
    if (this.isDestroyed()) return new Disposable();

    const observer = { callback, subscription: null };
    this.embeddedObservers.add(observer);
    if (this.view) {
      observer.subscription = this.observeViewEmbeddedTextEditor(this.view, callback);
    }

    return new Disposable(() => {
      this.embeddedObservers.delete(observer);
      observer.subscription?.dispose();
    });
  }

  onDidChangeTitle(callback) {
    return this.emitter.on("did-change-title", callback);
  }

  onDidChangeIcon(callback) {
    return this.emitter.on("did-change-icon", callback);
  }

  onDidDestroy(callback) {
    return this.emitter.on("did-destroy", callback);
  }

  onDidTerminatePendingState(callback) {
    return this.emitter.on("did-terminate-pending-state", callback);
  }

  terminatePendingState() {
    if (this.pendingStateTerminated) return;
    this.didTerminatePendingState();
    this.view?.terminatePendingState?.();
  }

  didTerminatePendingState() {
    if (this.pendingStateTerminated) return;
    this.pendingStateTerminated = true;
    this.emitter.emit("did-terminate-pending-state");
  }

  destroyFromView() {
    if (this.state === "destroyed") return;

    this.state = "destroyed";
    this.viewSubscriptions.dispose();
    for (const observer of this.embeddedObservers) observer.subscription?.dispose();
    this.embeddedObservers.clear();
    this.emitter.emit("did-destroy");
    this.emitter.dispose();
    this.view = null;
  }

  destroy() {
    if (this.state === "destroyed") return;

    const view = this.view;
    this.state = "destroyed";
    this.viewSubscriptions.dispose();
    for (const observer of this.embeddedObservers) observer.subscription?.dispose();
    this.embeddedObservers.clear();
    if (!view) this.resolveHydration(null);
    this.emitter.emit("did-destroy");
    this.emitter.dispose();
    this.view = null;
    view?.destroy?.();
  }
}
