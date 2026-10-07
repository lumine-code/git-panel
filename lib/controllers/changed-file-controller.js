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
        surfaceKind="file"
        {...this.props}
        title={this.props.stagingStatus === "staged" ? "Staged Changes" : "Unstaged Changes"}
        surface={this.surface}
        openMirrorPatch={this.openMirrorPatch}
      />,
    );
  }

  openMirrorPatch = (relPath, stagingStatus) => {
    const ChangedFileItem = require("../items/changed-file-item").default;
    const uri = ChangedFileItem.buildURI(
      relPath,
      this.props.repository.getWorkingDirectoryPath(),
      stagingStatus,
    );
    this.props.destroy();
    return this.props.workspace.open(uri);
  };

  surface = () => this.props.surfaceFileAtPath(this.props.relPath, this.props.stagingStatus);
}
