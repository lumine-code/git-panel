/** @babel */
/** @jsx h */
import { View, h } from "./etch/view.js";

export default class ContextMenuInterceptor extends View {
  constructor(props, children) {
    super(props, children);
    this.initialize();
  }

  static registration = new Map();

  static handle(event) {
    for (const [element, callback] of ContextMenuInterceptor.registration) {
      if (element.contains(event.target)) {
        callback(event);
      }
    }
  }

  static dispose() {
    for (const [element, callback] of ContextMenuInterceptor.registration)
      element.removeEventListener("contextmenu", callback, true);
    ContextMenuInterceptor.registration.clear();
  }

  didMount() {
    this.registeredElement = this.element;
    const previous = ContextMenuInterceptor.registration.get(this.element);
    if (previous) this.element.removeEventListener("contextmenu", previous, true);
    const callback = (...args) => this.props.onWillShowContextMenu(...args);
    this.element.addEventListener("contextmenu", callback, true);
    ContextMenuInterceptor.registration.set(this.element, callback);
  }

  render() {
    return (
      <div
        ref={(e) => {
          this.element = e;
        }}
      >
        {this.props.children}
      </div>
    );
  }

  willDestroy() {
    const element = this.registeredElement;
    const callback = ContextMenuInterceptor.registration.get(element);
    if (callback) element.removeEventListener("contextmenu", callback, true);
    ContextMenuInterceptor.registration.delete(element);
    this.registeredElement = null;
  }
}
