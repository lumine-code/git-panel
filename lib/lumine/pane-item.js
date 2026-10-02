/** @babel */
import { CompositeDisposable } from "lumine";
import View, { h, mount, transaction } from "../etch/view";
import { URIPattern, nonURIMatch } from "./uri-pattern-core";
import RefHolder from "../models/ref-holder";

// Workspace hosts own identity; this registration owns their native views.
export default class PaneItem extends View {
  constructor(props, children) {
    super(props, children);
    this.uriPattern = new URIPattern(this.props.uriPattern);
    this.subscriptions = new CompositeDisposable();
    this.openItems = new Map();
    this.initialize();
  }
  render() {
    return h("span", { hidden: true });
  }
  didMount() {
    for (const item of this.props.workspace.getPaneItems()) this.adoptItem(item);
    this.subscriptions.add(
      this.props.workspace.onDidAddPaneItem(({ item }) => this.adoptItem(item)),
      this.props.workspace.onDidDestroyPaneItem(({ item }) => {
        const open = this.openItems.get(item);
        if (!open) return;
        this.openItems.delete(item);
        open.dispose();
      }),
      this.props.workspace.addOpener(this.opener),
    );
  }
  didUpdate(previous) {
    if (previous.uriPattern !== this.props.uriPattern)
      this.uriPattern = new URIPattern(this.props.uriPattern);
    for (const open of this.openItems.values()) open.update(this.props.children);
  }
  createPaneItem(match, deserialized = {}) {
    if (typeof this.props.createPaneItem !== "function")
      throw new Error("PaneItem requires a createPaneItem factory.");
    const item = this.props.createPaneItem({
      uri: match.getURI(),
      params: match.getParams(),
      deserialized,
    });
    if (!item || typeof item.getHydrationState !== "function")
      throw new Error("PaneItem factory must return a PaneItemHost.");
    return item;
  }
  opener = (uri) => {
    if (this.destroyed) return;
    const match = this.uriPattern.matches(uri);
    if (!match.ok()) return;
    const item = this.createPaneItem(match);
    this.adoptItem(item);
    return item;
  };
  adoptItem(item) {
    if (
      this.destroyed ||
      !item ||
      typeof item.getHydrationState !== "function" ||
      item.isDestroyed() ||
      item.isHydrated() ||
      this.openItems.has(item)
    )
      return;
    const match = item.getURI ? this.uriPattern.matches(item.getURI()) : nonURIMatch;
    if (!match.ok() || !item.getElement?.()) return;
    const open = new OpenItem(match, item, this.props.className);
    this.openItems.set(item, open);
    item.setCopyFactory(() => {
      if (this.destroyed || item.isDestroyed()) return null;
      const copy = this.createPaneItem(match, item.getHydrationProps());
      this.adoptItem(copy);
      return copy;
    });
    open.update(this.props.children);
  }
  willDestroy() {
    this.subscriptions.dispose();
    for (const open of this.openItems.values()) open.dispose();
    this.openItems.clear();
  }
}

class OpenItem {
  constructor(match, paneItem, className) {
    this.match = match;
    this.paneItem = paneItem;
    this.domNode = paneItem.getElement();
    this.domNode.tabIndex = -1;
    if (className) this.domNode.classList.add(className);
    this.itemHolder = new RefHolder();
    this.disposed = false;
    this.onFocus = () => {
      if (!this.disposed) this.itemHolder.getOr(null)?.focus?.();
    };
    this.domNode.addEventListener("focus", this.onFocus);
    this.hydrationSubscription = this.itemHolder.observe((view) => {
      if (this.disposed || paneItem.isDestroyed()) {
        view.destroy?.();
        return;
      }
      paneItem.hydrate(view);
    });
  }
  update(renderView) {
    if (this.disposed || this.paneItem.isDestroyed()) return;
    const node = renderView({
      paneItem: this.paneItem,
      itemHolder: this.itemHolder,
      deserialized: this.paneItem.getHydrationProps(),
      params: this.match.getParams(),
      uri: this.match.getURI(),
    });
    transaction(() => {
      if (this.view) this.view.update(node);
      else this.view = mount(node, this.domNode);
    });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.hydrationSubscription.dispose();
    this.domNode.removeEventListener("focus", this.onFocus);
    this.view?.destroy();
    this.itemHolder.setter(null);
    this.paneItem.setCopyFactory(null);
    this.paneItem.destroy();
  }
}
