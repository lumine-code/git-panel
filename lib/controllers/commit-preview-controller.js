/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";

import MultiFilePatchController from "./multi-file-patch-controller";

export default class CommitPreviewController extends View {
  constructor(props, children) {
    super(props, children);
    this.initialize();
  }

  render() {
    return h(
      "span",
      { style: { display: "contents" } },
      <MultiFilePatchController
        surface={this.props.surfaceToCommitPreviewButton}
        {...this.props}
      />,
    );
  }
}
