/** @babel */
/** @jsx h */
import { View, h } from "../etch/view.js";

// The view can render before its package's protocol host is registered, and
// imported views in specs have no active package host at all.
export const FALLBACK_AVATAR = new URL("../../img/avatar.svg", import.meta.url).href;

export default class Avatar extends View {
  static deriveState(props, state) {
    const source = props.src || FALLBACK_AVATAR;
    return source === state.source ? null : { source, failed: false };
  }

  constructor(props, children) {
    super(props, children);
    this.initialize();
  }

  render() {
    const source = this.state.failed ? FALLBACK_AVATAR : this.state.source;
    return (
      <img
        className={this.props.className}
        src={source}
        title={this.props.title}
        alt={this.props.alt}
        onError={() => this.didFail(source)}
      />
    );
  }

  didFail(source) {
    // A retired request must not replace the next author's image. A missing
    // bundled asset must not repeatedly assign its own failed URL either.
    if (
      this.destroyed ||
      source === FALLBACK_AVATAR ||
      source !== this.state.source ||
      this.state.failed
    )
      return;
    return this.updateState({ failed: true });
  }
}
