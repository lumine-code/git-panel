/** @babel */
import { autobind } from "../helpers";

export default class TabTracker {
  constructor(name, { getWorkspace, uri }) {
    autobind(this, "toggle", "toggleFocus", "ensureVisible");
    this.name = name;

    this.getWorkspace = getWorkspace;
    this.uri = uri;
  }

  async toggle() {
    const focusToRestore = document.activeElement;
    let shouldRestoreFocus;

    await this.ensureCorrectLocation();

    // Rendered => the dock item is being rendered, whether or not the dock is visible or the item
    //   is visible within its dock.
    // Visible => the item is active and the dock item is active within its dock.
    const wasRendered = this.isRendered();
    const wasVisible = this.isVisible();

    if (!wasRendered || !wasVisible) {
      // Not rendered, or rendered but not an active item in a visible dock.
      await this.reveal();
      shouldRestoreFocus = true;
    } else {
      // Rendered and an active item within a visible dock. Move focus to the
      // center workspace before hiding so later focus events don't reactivate
      // the now-hidden dock pane (matches the editor's own Dock.toggle behavior).
      let workspace = this.getWorkspace();
      if (workspace.getCenter) {
        workspace = workspace.getCenter();
      }
      workspace.getActivePane().activate();
      await this.hide();
      shouldRestoreFocus = false;
    }

    if (shouldRestoreFocus) {
      process.nextTick(() => focusToRestore.focus());
    }
  }

  async toggleFocus() {
    await this.ensureCorrectLocation();
    const hadFocus = this.hasFocus();
    await this.ensureVisible();

    if (hadFocus) {
      let workspace = this.getWorkspace();
      if (workspace.getCenter) {
        workspace = workspace.getCenter();
      }
      workspace.getActivePane().activate();
    } else {
      this.focus();
    }
  }

  async ensureVisible() {
    await this.ensureCorrectLocation();
    if (!this.isVisible()) {
      await this.reveal();
      return true;
    }
    return false;
  }

  ensureRendered() {
    return this.getWorkspace()
      .open(this.uri, {
        searchAllPanes: true,
        activateItem: false,
        activatePane: false,
      })
      .then((item) => {
        this.ensureCorrectLocation(item);
        return item;
      });
  }

  reveal() {
    return this.getWorkspace()
      .open(this.uri, {
        searchAllPanes: true,
        activateItem: true,
        activatePane: true,
      })
      .then((item) => {
        this.ensureCorrectLocation(item);
        return item;
      });
  }

  ensureCorrectLocation(item = this.getItem()) {
    const workspace = this.getWorkspace();
    const pane = item ? workspace.paneForItem(item) : null;
    const allowedLocations = item?.getAllowedLocations?.();
    const currentLocation = pane?.getContainer?.().getLocation?.();
    if (!pane || !Array.isArray(allowedLocations) || allowedLocations.includes(currentLocation)) {
      return item;
    }

    const desiredLocation = item.getDefaultLocation?.();
    const container = workspace
      .getPaneContainers?.()
      ?.find((candidate) => candidate.getLocation?.() === desiredLocation);
    const destination = container?.getActivePane?.();
    if (destination && destination !== pane) {
      pane.moveItemToPane(item, destination);
    }
    return item;
  }

  hide() {
    return this.getWorkspace().hide(this.uri);
  }

  focus() {
    const component = this.getComponent();
    if (component?.restoreFocus) {
      return component.restoreFocus();
    }

    // A cold command can reveal the host before React hydrates it. Focusing
    // the host element is safe and prevents the first dispatch from throwing;
    // PaneItem attaches the real component on the next render.
    this.getDOMElement()?.focus?.();
  }

  getItem() {
    const pane = this.getWorkspace().paneForURI(this.uri);
    if (!pane) {
      return null;
    }

    const paneItem = pane.itemForURI(this.uri);
    if (!paneItem) {
      return null;
    }

    return paneItem;
  }

  getComponent() {
    const paneItem = this.getItem();
    if (!paneItem) {
      return null;
    }
    if (typeof paneItem.getHydratedView !== "function") {
      return null;
    }

    return paneItem.getHydratedView();
  }

  getDOMElement() {
    const paneItem = this.getItem();
    if (!paneItem) {
      return null;
    }
    if (typeof paneItem.getElement !== "function") {
      return null;
    }

    return paneItem.getElement();
  }

  isRendered() {
    return !!this.getWorkspace().paneForURI(this.uri);
  }

  isVisible() {
    const workspace = this.getWorkspace();
    return workspace
      .getPaneContainers()
      .filter((container) => container === workspace.getCenter() || container.isVisible())
      .some((container) =>
        container.getPanes().some((pane) => {
          const item = pane.getActiveItem();
          return item && item.getURI && item.getURI() === this.uri;
        }),
      );
  }

  hasFocus() {
    const root = this.getDOMElement();
    return root && root.contains(document.activeElement);
  }
}
