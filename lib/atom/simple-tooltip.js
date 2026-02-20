/** @babel */
/** @jsx React.createElement */
import React from "react";

export default class SimpleTooltip extends React.Component {
  componentDidMount() {
    if (this.wrapperRef) {
      this.disposable = this.props.tooltips.add(this.wrapperRef, { title: () => this.props.title });
    }
  }

  componentWillUnmount() {
    this.disposable && this.disposable.dispose();
  }

  componentDidUpdate(prevProps) {
    if (prevProps.title !== this.props.title && this.wrapperRef) {
      this.disposable && this.disposable.dispose();
      this.disposable = this.props.tooltips.add(this.wrapperRef, { title: () => this.props.title });
    }
  }

  render() {
    return (
      <span
        ref={(el) => {
          this.wrapperRef = el;
        }}
        style={{ display: "contents" }}
      >
        {this.props.children}
      </span>
    );
  }
}
