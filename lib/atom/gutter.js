/** @babel */
/** @jsx React.createElement */
import React from "react";
import { Disposable } from "atom";

import { autobind, extractProps } from "../helpers";
import { TextEditorContext } from "./atom-text-editor";
import RefHolder from "../models/ref-holder";

const gutterProps = {
  name: true,
  priority: true,
  visible: true,
  type: true,
  labelFn: true,
  onMouseDown: true,
  onMouseMove: true,
};

class BareGutter extends React.Component {
  static defaultProps = {
    visible: true,
    type: "decorated",
    labelFn: () => {},
  };

  constructor(props) {
    super(props);
    autobind(this, "observeEditor", "forceUpdate");

    this.state = {
      gutter: null,
    };

    this.sub = new Disposable();
  }

  componentDidMount() {
    this.sub = this.props.editorHolder.observe(this.observeEditor);
  }

  componentDidUpdate(prevProps) {
    if (this.props.editorHolder !== prevProps.editorHolder) {
      this.sub.dispose();
      this.sub = this.props.editorHolder.observe(this.observeEditor);
    }
  }

  componentWillUnmount() {
    if (this.state.gutter !== null) {
      try {
        this.state.gutter.destroy();
      } catch (e) {
        // Gutter already destroyed. Disregard.
      }
    }
    this.sub.dispose();
  }

  render() {
    return null;
  }

  observeEditor(editor) {
    this.setState((prevState, props) => {
      if (prevState.gutter !== null) {
        prevState.gutter.destroy();
      }

      const options = extractProps(props, gutterProps);
      options.class = props.className;
      return { gutter: editor.addGutter(options) };
    });
  }
}

export default class Gutter extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      editorHolder: RefHolder.on(this.props.editor),
    };
  }

  static getDerivedStateFromProps(props, state) {
    const editorChanged = state.editorHolder
      .map((editor) => editor !== props.editor)
      .getOr(props.editor !== undefined);
    return editorChanged ? RefHolder.on(props.editor) : null;
  }

  render() {
    if (!this.state.editorHolder.isEmpty()) {
      return <BareGutter {...this.props} editorHolder={this.state.editorHolder} />;
    }

    return (
      <TextEditorContext.Consumer>
        {(editorHolder) => <BareGutter {...this.props} editorHolder={editorHolder} />}
      </TextEditorContext.Consumer>
    );
  }
}
