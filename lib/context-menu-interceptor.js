/** @babel */
/** @jsx h */
import { View, h } from "./etch/view";

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
    document.removeEventListener("contextmenu", contextMenuHandler, { capture: true });
  }

  didMount() {
    // Helpfully, addEventListener dedupes listeners for us.
    document.addEventListener("contextmenu", contextMenuHandler, { capture: true });
    ContextMenuInterceptor.registration.set(this.element, (...args) =>
      this.props.onWillShowContextMenu(...args),
    );
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
    ContextMenuInterceptor.registration.delete(this.element);
  }
}

function contextMenuHandler(event) {
  ContextMenuInterceptor.handle(event);
}
