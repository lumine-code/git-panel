/** @babel */
/** @jsx React.createElement */
import React, { Fragment } from "react";
import { Disposable } from "lumine";

import RefHolder from "../models/ref-holder";

export default class Commands extends React.Component {
  render() {
    const { registry, target } = this.props;
    // A Fragment, never an element: every `Command` renders null, so a wrapper
    // would be an empty box — and inside the status bar tile group, an empty
    // flex item still takes a `gap` and pushes the first control along.
    return (
      <Fragment>
        {React.Children.map(this.props.children, (child) => {
          return child ? React.cloneElement(child, { registry, target }) : null;
        })}
      </Fragment>
    );
  }
}

export class Command extends React.Component {
  constructor(props, context) {
    super(props, context);
    this.subTarget = new Disposable();
    this.subCommand = new Disposable();
  }

  componentDidMount() {
    this.observeTarget(this.props);
  }

  componentDidUpdate(prevProps) {
    if (["registry", "target", "command", "callback"].some((p) => prevProps[p] !== this.props[p])) {
      this.observeTarget(this.props);
    }
  }

  componentWillUnmount() {
    this.subTarget.dispose();
    this.subCommand.dispose();
  }

  observeTarget(props) {
    this.subTarget.dispose();
    this.subTarget = RefHolder.on(props.target).observe((t) => this.registerCommand(t, props));
  }

  registerCommand(target, { registry, command, callback }) {
    this.subCommand.dispose();
    this.subCommand = registry.add(target, command, callback);
  }

  render() {
    return null;
  }
}
