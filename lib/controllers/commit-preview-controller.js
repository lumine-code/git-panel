/** @babel */
/** @jsx React.createElement */
import React from "react";

import MultiFilePatchController from "./multi-file-patch-controller";

export default class CommitPreviewController extends React.Component {
  render() {
    return (
      <MultiFilePatchController surface={this.props.surfaceToCommitPreviewButton} {...this.props} />
    );
  }
}
