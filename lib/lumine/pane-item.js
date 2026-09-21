/** @babel */
/** @jsx React.createElement */
import React, { Fragment } from "react";
import ReactDOM from "react-dom";
import { CompositeDisposable } from "lumine";

import { URIPattern, nonURIMatch } from "./uri-pattern-core";
import RefHolder from "../models/ref-holder";
import { autobind } from "../helpers";

/**
 * PaneItem registers a React-backed pane-item opener while this component is
 * mounted. The workspace item is a PaneItemHost; React only supplies the view
 * that hydrates that host.
 */
export default class PaneItem extends React.Component {
  constructor(props) {
    super(props);
    autobind(this, "opener");

    const uriPattern = new URIPattern(this.props.uriPattern);
    const currentlyOpen = this.props.workspace.getPaneItems().reduce((items, item) => {
      const element = item.getElement ? item.getElement() : null;
      const match = item.getURI ? uriPattern.matches(item.getURI()) : nonURIMatch;

      if (
        element &&
        match.ok() &&
        typeof item.getHydrationState === "function" &&
        !item.isDestroyed()
      ) {
        items.push(new OpenItem(match, item));
      }

      return items;
    }, []);

    this.subs = new CompositeDisposable();
    this.openItems = new WeakMap();
    this.pendingOpenItems = new Set();
    this.state = { uriPattern, currentlyOpen };
  }

  static getDerivedStateFromProps(nextProps, prevState) {
    if (prevState.uriPattern.getOriginal() === nextProps.uriPattern) return null;
    return { uriPattern: new URIPattern(nextProps.uriPattern) };
  }

  componentDidMount() {
    // Adopt hosts opened by a cold opener or deserializer after this component
    // mounted. The host itself remains the workspace item throughout.
    this.subs.add(
      this.props.workspace.onDidAddPaneItem(({ item }) => {
        if (typeof item.getHydrationState !== "function" || item.isDestroyed()) return;
        if (item.isHydrated()) return;
        if (this.pendingOpenItems.has(item)) return;

        const match = this.state.uriPattern.matches(item.getURI());
        if (!match.ok()) return;

        const openItem = this.adoptItem(match, item);
        if (this.state.currentlyOpen.includes(openItem)) return;
        this.setState((prevState) => ({
          currentlyOpen: [...prevState.currentlyOpen, openItem],
        }));
      }),
    );

    for (const openItem of this.state.currentlyOpen) this.prepareOpenItem(openItem);
    this.subs.add(this.props.workspace.addOpener(this.opener));
  }

  render() {
    return this.state.currentlyOpen.map((item) => (
      <Fragment key={item.getKey()}>{item.renderPortal(this.props.children)}</Fragment>
    ));
  }

  componentWillUnmount() {
    this.state.currentlyOpen.forEach((openItem) => openItem.dispose());
    this.subs.dispose();
  }

  opener(uri) {
    const match = this.state.uriPattern.matches(uri);
    if (!match.ok()) return undefined;

    const paneItem = this.createPaneItem(match, {});
    const openItem = new OpenItem(match, paneItem);
    if (this.props.className) openItem.addClassName(this.props.className);

    this.prepareOpenItem(openItem);
    this.pendingOpenItems.add(paneItem);
    this.setState(
      (prevState) => ({
        currentlyOpen: [...prevState.currentlyOpen, openItem],
      }),
      () => this.pendingOpenItems.delete(paneItem),
    );
    return paneItem;
  }

  createPaneItem(match, deserialized) {
    if (typeof this.props.createPaneItem !== "function") {
      throw new Error(`PaneItem '${match.getURI()}' requires a createPaneItem factory`);
    }

    const paneItem = this.props.createPaneItem({
      uri: match.getURI(),
      params: match.getParams(),
      deserialized,
    });
    if (!paneItem || typeof paneItem.getHydrationState !== "function") {
      throw new Error(`PaneItem factory did not return a PaneItemHost for '${match.getURI()}'`);
    }
    return paneItem;
  }

  adoptItem(match, paneItem) {
    const existing = this.openItems.get(paneItem);
    if (existing) return existing;

    const openItem = new OpenItem(match, paneItem);
    if (this.props.className) openItem.addClassName(this.props.className);
    this.prepareOpenItem(openItem);
    return openItem;
  }

  prepareOpenItem(openItem) {
    this.openItems.set(openItem.paneItem, openItem);
    openItem.setCopy(() => this.copyOpenItem(openItem));
    this.registerCloseListener(openItem.paneItem, openItem);
    openItem.hydrate();
  }

  copyOpenItem(openItem) {
    const match = this.state.uriPattern.matches(openItem.getURI());
    if (!match.ok()) return null;

    const paneItem = this.createPaneItem(match, openItem.getHydrationProps());
    const copiedItem = new OpenItem(match, paneItem);
    this.pendingOpenItems.add(paneItem);
    this.setState(
      (prevState) => ({
        currentlyOpen: [...prevState.currentlyOpen, copiedItem],
      }),
      () => this.pendingOpenItems.delete(paneItem),
    );
    this.prepareOpenItem(copiedItem);
    return paneItem;
  }

  registerCloseListener(paneItem, openItem) {
    if (openItem.closeSubscription) return;

    const subscription = this.props.workspace.onDidDestroyPaneItem(({ item }) => {
      if (item !== paneItem) return;
      subscription.dispose();
      this.subs.remove(subscription);
      this.openItems.delete(paneItem);
      openItem.dispose();
      this.setState((prevState) => ({
        currentlyOpen: prevState.currentlyOpen.filter((each) => each !== openItem),
      }));
    });

    openItem.closeSubscription = subscription;
    this.subs.add(subscription);
  }
}

/** A React portal and its stable workspace item. */
class OpenItem {
  static nextID = 0;

  constructor(match, paneItem) {
    this.id = this.constructor.nextID++;
    this.paneItem = paneItem;
    this.domNode = paneItem.getElement();
    this.domNode.tabIndex = "-1";
    this.domNode.onfocus = this.onFocus.bind(this);
    this.match = match;
    this.itemHolder = new RefHolder();
    this.hydrationSubscription = null;
    this.closeSubscription = null;
    this.disposed = false;
  }

  getURI() {
    return this.match.getURI();
  }

  getHydrationProps() {
    return this.paneItem.getHydrationProps();
  }

  setCopy(copyFactory) {
    this.paneItem.setCopyFactory(copyFactory);
  }

  hydrate() {
    if (this.hydrationSubscription || this.paneItem.isHydrated() || this.paneItem.isDestroyed()) {
      return;
    }

    this.hydrationSubscription = this.itemHolder.observe((view) => {
      if (this.paneItem.isDestroyed()) {
        view.destroy?.();
        return;
      }

      this.paneItem.hydrate(view);
      this.hydrationSubscription?.dispose();
      this.hydrationSubscription = null;
    });
  }

  addClassName(className) {
    this.domNode.classList.add(className);
  }

  getKey() {
    return this.id;
  }

  onFocus() {
    if (this.itemHolder.isEmpty()) return this.domNode.focus();
    return this.itemHolder.get().focus?.();
  }

  renderPortal(renderProp) {
    return ReactDOM.createPortal(
      renderProp({
        paneItem: this.paneItem,
        itemHolder: this.itemHolder,
        deserialized: this.getHydrationProps(),
        params: this.match.getParams(),
        uri: this.match.getURI(),
      }),
      this.domNode,
    );
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.hydrationSubscription?.dispose();
    this.hydrationSubscription = null;
    this.closeSubscription?.dispose();
    this.closeSubscription = null;
  }
}
