/** @babel */
/** @jsx React.createElement */
import React from "react";

export default class SelectBox extends React.Component {
  componentDidMount() {
    this.controller = lumine.menu.createSelectBox({
      items: this.props.items || [],
      value: this.props.value,
      disabled: Boolean(this.props.disabled),
      ariaLabel: this.props.ariaLabel,
      className: this.props.className,
      onWillOpen: (controller) => this.props.onWillOpen?.(controller),
    });
    this.changeSubscription = this.controller.onDidChange((event) => {
      this.props.onDidChange?.(event);
    });
    this.host.appendChild(this.controller.element);
  }

  componentDidUpdate() {
    this.controller.setItems(this.props.items || [], { value: this.props.value });
    if (this.props.value !== undefined) this.controller.setValue(this.props.value);
    this.controller.setEnabled(!this.props.disabled);
  }

  componentWillUnmount() {
    this.changeSubscription?.dispose();
    this.controller?.destroy();
  }

  get element() {
    return this.controller?.element || null;
  }

  get value() {
    return this.controller?.value;
  }

  get items() {
    return this.props.items || [];
  }

  setValue(value, options) {
    return this.controller?.setValue(value, options);
  }

  selectNext(options) {
    return this.controller?.selectNext(options);
  }

  selectPrevious(options) {
    return this.controller?.selectPrevious(options);
  }

  focus() {
    this.controller?.focus();
  }

  render() {
    return <span ref={(element) => (this.host = element)} style={{ display: "contents" }} />;
  }
}
