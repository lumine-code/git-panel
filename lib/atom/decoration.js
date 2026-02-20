/** @babel */
/** @jsx React.createElement */
import React from "react";
import ReactDOM from "react-dom";
import { Disposable } from "atom";
import cx from "classnames";

import { createItem, extractProps } from "../helpers";
import { TextEditorContext } from "./atom-text-editor";
import { DecorableContext } from "./marker";
import RefHolder from "../models/ref-holder";

const decorationPropTypes = {
  type: true,
  className: true,
  style: true,
  onlyHead: true,
  onlyEmpty: true,
  onlyNonEmpty: true,
  omitEmptyLastRow: true,
  position: true,
  order: true,
  avoidOverflow: true,
  gutterName: true,
};

class BareDecoration extends React.Component {
  static defaultProps = {
    decorateMethod: "decorateMarker",
  };

  constructor(props, context) {
    super(props, context);

    this.decorationHolder = new RefHolder();
    this.editorSub = new Disposable();
    this.decorableSub = new Disposable();
    this.gutterSub = new Disposable();

    this.domNode = null;
    this.item = null;

    if (["gutter", "overlay", "block"].includes(this.props.type)) {
      this.domNode = document.createElement("div");
      this.domNode.className = cx("react-atom-decoration", this.props.className);
    }
  }

  usesItem() {
    return this.domNode !== null;
  }

  componentDidMount() {
    this.editorSub = this.props.editorHolder.observe(this.observeParents);
    this.decorableSub = this.props.decorableHolder.observe(this.observeParents);
  }

  componentDidUpdate(prevProps) {
    if (this.props.editorHolder !== prevProps.editorHolder) {
      this.editorSub.dispose();
      this.editorSub = this.props.editorHolder.observe(this.observeParents);
    }

    if (this.props.decorableHolder !== prevProps.decorableHolder) {
      this.decorableSub.dispose();
      this.decorableSub = this.props.decorableHolder.observe(this.observeParents);
    }

    if (Object.keys(decorationPropTypes).some((key) => this.props[key] !== prevProps[key])) {
      this.decorationHolder.map((decoration) => decoration.destroy());
      this.createDecoration();
    }
  }

  render() {
    if (this.usesItem()) {
      return ReactDOM.createPortal(this.props.children, this.domNode);
    } else {
      return null;
    }
  }

  observeParents = () => {
    this.decorationHolder.map((decoration) => decoration.destroy());

    const editorValid = this.props.editorHolder.map((editor) => !editor.isDestroyed()).getOr(false);
    const decorableValid = this.props.decorableHolder
      .map((decorable) => !decorable.isDestroyed())
      .getOr(false);

    // Ensure the Marker or MarkerLayer corresponds to the context's TextEditor
    const decorableMatches = this.props.decorableHolder
      .map((decorable) =>
        this.props.editorHolder
          .map((editor) => {
            const layer = decorable.layer || decorable;
            const displayLayer = editor.getMarkerLayer(layer.id);
            if (!displayLayer) {
              return false;
            }
            if (displayLayer !== layer && displayLayer.bufferMarkerLayer !== layer) {
              return false;
            }
            return true;
          })
          .getOr(false),
      )
      .getOr(false);

    if (!editorValid || !decorableValid || !decorableMatches) {
      return;
    }

    // delay decoration creation when it's a gutter type;
    // instead wait for the Gutter to be added to the editor first
    if (this.props.type === "gutter") {
      if (!this.props.gutterName) {
        throw new Error("You are trying to decorate a gutter but did not supply gutterName prop.");
      }
      this.props.editorHolder.map((editor) => {
        this.gutterSub = editor.observeGutters((gutter) => {
          if (gutter.name === this.props.gutterName) {
            this.createDecoration();
          }
        });
        return null;
      });
      return;
    }

    this.createDecoration();
  };

  createDecoration() {
    if (this.usesItem() && !this.item) {
      this.item = createItem(this.domNode, this.props.itemHolder);
    }

    const opts = this.getDecorationOpts(this.props);
    const editor = this.props.editorHolder.get();
    const decorable = this.props.decorableHolder.get();
    this.decorationHolder.setter(editor[this.props.decorateMethod](decorable, opts));
  }

  componentWillUnmount() {
    this.decorationHolder.map((decoration) => decoration.destroy());
    this.editorSub.dispose();
    this.decorableSub.dispose();
    this.gutterSub.dispose();
  }

  getDecorationOpts(props) {
    return {
      ...extractProps(props, decorationPropTypes, { className: "class" }),
      item: this.item,
    };
  }
}

export default class Decoration extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      editorHolder: RefHolder.on(this.props.editor),
      decorableHolder: RefHolder.on(this.props.decorable),
    };
  }

  static getDerivedStateFromProps(props, state) {
    const editorChanged = state.editorHolder
      .map((editor) => editor !== props.editor)
      .getOr(props.editor !== undefined);
    const decorableChanged = state.decorableHolder
      .map((decorable) => decorable !== props.decorable)
      .getOr(props.decorable !== undefined);

    if (!editorChanged && !decorableChanged) {
      return null;
    }

    const nextState = {};
    if (editorChanged) {
      nextState.editorHolder = RefHolder.on(props.editor);
    }
    if (decorableChanged) {
      nextState.decorableHolder = RefHolder.on(props.decorable);
    }
    return nextState;
  }

  render() {
    return (
      <TextEditorContext.Consumer>
        {(editorHolder) => (
          <DecorableContext.Consumer>
            {(decorable) => {
              let holder = null;
              let decorateMethod = null;
              if (!this.state.decorableHolder.isEmpty()) {
                holder = this.state.decorableHolder;
                decorateMethod = this.props.decorateMethod;
              } else {
                holder = decorable.holder;
                decorateMethod = decorable.decorateMethod;
              }

              return (
                <BareDecoration
                  editorHolder={editorHolder || this.state.editorHolder}
                  decorableHolder={holder}
                  decorateMethod={decorateMethod}
                  {...this.props}
                />
              );
            }}
          </DecorableContext.Consumer>
        )}
      </TextEditorContext.Consumer>
    );
  }
}
