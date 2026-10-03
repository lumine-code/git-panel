/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";

import ChangesView from "../views/changes-view";

export default class ChangedFileController extends View {
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
        title={this.props.stagingStatus === "staged" ? "Staged Changes" : "Unstaged Changes"}
        surface={this.surface}
      />,
    );
  }

  surface = () => this.props.surfaceFileAtPath(this.props.relPath, this.props.stagingStatus);
}
