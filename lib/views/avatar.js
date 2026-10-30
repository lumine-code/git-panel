/** @babel */
/** @jsx h */
import { View, h } from "../etch/view.js";

export const FALLBACK_AVATAR = "lumine://git-panel/img/avatar.svg";

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
