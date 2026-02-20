/** @babel */
/** @jsx React.createElement */
import React from "react";

import { blankLabel } from "../helpers";
import AtomTextEditor from "../atom/atom-text-editor";
import Decoration from "../atom/decoration";
import MarkerLayer from "../atom/marker-layer";
import Gutter from "../atom/gutter";

export default class PatchPreviewView extends React.Component {
  state = {
    lastPatch: null,
    lastFileName: null,
    lastDiffRow: null,
    lastMaxRowCount: null,
    previewPatchBuffer: null,
  };

  static getDerivedStateFromProps(props, state) {
    if (
      props.multiFilePatch === state.lastPatch &&
      props.fileName === state.lastFileName &&
      props.diffRow === state.lastDiffRow &&
      props.maxRowCount === state.lastMaxRowCount
    ) {
      return null;
    }

    const nextPreviewPatchBuffer = props.multiFilePatch.getPreviewPatchBuffer(
      props.fileName,
      props.diffRow,
      props.maxRowCount,
    );
    let previewPatchBuffer = null;
    if (state.previewPatchBuffer !== null) {
      state.previewPatchBuffer.adopt(nextPreviewPatchBuffer);
      previewPatchBuffer = state.previewPatchBuffer;
    } else {
      previewPatchBuffer = nextPreviewPatchBuffer;
    }

    return {
      lastPatch: props.multiFilePatch,
      lastFileName: props.fileName,
      lastDiffRow: props.diffRow,
      lastMaxRowCount: props.maxRowCount,
      previewPatchBuffer,
    };
  }

  render() {
    return (
      <AtomTextEditor
        buffer={this.state.previewPatchBuffer.getBuffer()}
        readOnly={true}
        lineNumberGutterVisible={false}
        autoHeight={true}
        autoWidth={false}
        softWrapped={false}
      >
        {this.props.config.get("git-panel.showDiffIconGutter") && (
          <Gutter
            name="diff-icons"
            priority={1}
            type="line-number"
            className="icons"
            labelFn={blankLabel}
          />
        )}

        {this.renderLayerDecorations("addition", "git-panel-FilePatchView-line--added")}
        {this.renderLayerDecorations("deletion", "git-panel-FilePatchView-line--deleted")}
      </AtomTextEditor>
    );
  }

  renderLayerDecorations(layerName, className) {
    const layer = this.state.previewPatchBuffer.getLayer(layerName);
    if (layer.getMarkerCount() === 0) {
      return null;
    }

    return (
      <MarkerLayer external={layer}>
        <Decoration type="line" className={className} omitEmptyLastRow={false} />
        {this.props.config.get("git-panel.showDiffIconGutter") && (
          <Decoration
            type="line-number"
            gutterName="diff-icons"
            className={className}
            omitEmptyLastRow={false}
          />
        )}
      </MarkerLayer>
    );
  }
}
