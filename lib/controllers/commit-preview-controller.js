/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";

import ChangesView from "../views/changes-view";

export default class CommitPreviewController extends View {
  constructor(props, children) {
    super(props, children);
    this.initialize();
  }

  render() {
    return h(
      "span",
      { style: { display: "contents" } },
      <ChangesView
        {...this.props}
        title="Staged Changes"
        surface={this.props.surfaceToCommitPreviewButton}
      />,
    );
  }
}
