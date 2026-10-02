/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";

export default class LoadingView extends View {
  constructor(props, children) {
    super(props, children);
    this.initialize();
  }

  render() {
    return (
      <div className="git-panel-Loader">
        <span className="git-panel-Spinner" />
      </div>
    );
  }
}
