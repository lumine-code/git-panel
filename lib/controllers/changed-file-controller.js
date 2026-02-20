/** @babel */
/** @jsx React.createElement */
import React from "react";

import MultiFilePatchController from "./multi-file-patch-controller";

export default class ChangedFileController extends React.Component {
  render() {
    return <MultiFilePatchController surface={this.surface} {...this.props} />;
  }

  surface = () => this.props.surfaceFileAtPath(this.props.relPath, this.props.stagingStatus);
}
