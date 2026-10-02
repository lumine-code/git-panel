/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";

import MultiFilePatchController from "./multi-file-patch-controller";

export default class ChangedFileController extends View {
  constructor(props, children) {
    super(props, children);
    this.initialize();
  }

  render() {
    return h(
      "span",
      { style: { display: "contents" } },
      <MultiFilePatchController
        {...this.props}
        ref={this.props.refPatchController?.setter}
        surface={this.surface}
      />,
    );
  }

  surface = () => this.props.surfaceFileAtPath(this.props.relPath, this.props.stagingStatus);
}
