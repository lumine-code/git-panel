/** @babel */
/** @jsx React.createElement */
import React from "react";

import Author from "../models/author";
import Commands, { Command } from "../atom/commands";
import { autobind } from "../helpers";

export default class CoAuthorForm extends React.Component {
  static defaultProps = {
    onSubmit: () => {},
    onCancel: () => {},
  };

  constructor(props, context) {
    super(props, context);
    autobind(
      this,
      "confirm",
      "cancel",
      "onNameChange",
      "onEmailChange",
      "validate",
      "focusFirstInput",
      "focusNextInput",
      "focusPreviousInput",
    );

    this.state = {
      name: this.props.name,
      email: "",
      submitDisabled: true,
    };
  }

  componentDidMount() {
    setTimeout(this.focusFirstInput);
  }

  render() {
    return (
      <div className="git-panel-CoAuthorForm native-key-bindings">
        <Commands registry={this.props.commands} target=".git-panel-CoAuthorForm">
          <Command command="core:cancel" callback={this.cancel} />
          <Command command="core:confirm" callback={this.confirm} />
          <Command command="core:focus-next" callback={this.focusNextInput} />
          <Command command="core:focus-previous" callback={this.focusPreviousInput} />
        </Commands>
        <label className="git-panel-CoAuthorForm-row">
          <span className="git-panel-CoAuthorForm-label">Name:</span>
          <input
            type="text"
            placeholder="Co-author name"
            ref={(e) => (this.nameInput = e)}
            className="input-text git-panel-CoAuthorForm-name"
            value={this.state.name}
            onChange={this.onNameChange}
            tabIndex="1"
          />
        </label>
        <label className="git-panel-CoAuthorForm-row">
          <span className="git-panel-CoAuthorForm-label">E-mail:</span>
          <input
            type="email"
            placeholder="foo@bar.com"
            ref={(e) => (this.emailInput = e)}
            className="input-text git-panel-CoAuthorForm-email"
            value={this.state.email}
            onChange={this.onEmailChange}
            tabIndex="2"
          />
        </label>
        <footer className="git-panel-CoAuthorForm-row has-buttons">
          <button className="btn git-panel-CancelButton" tabIndex="3" onClick={this.cancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={this.state.submitDisabled}
            tabIndex="4"
            onClick={this.confirm}
          >
            Add Co-Author
          </button>
        </footer>
      </div>
    );
  }

  confirm() {
    if (this.isInputValid()) {
      this.props.onSubmit(new Author(this.state.email, this.state.name));
    }
  }

  cancel() {
    this.props.onCancel();
  }

  onNameChange(e) {
    this.setState({ name: e.target.value }, this.validate);
  }

  onEmailChange(e) {
    this.setState({ email: e.target.value }, this.validate);
  }

  validate() {
    if (this.isInputValid()) {
      this.setState({ submitDisabled: false });
    }
  }

  isInputValid() {
    // E-mail validation with regex has a LOT of corner cases, dawg.
    // https://stackoverflow.com/questions/48055431/can-it-cause-harm-to-validate-email-addresses-with-a-regex
    // to avoid bugs for users with nonstandard e-mail addresses,
    // just check to make sure e-mail address contains `@` and move on with our lives.
    return this.state.name && this.state.email.includes("@");
  }

  focusFirstInput() {
    this.nameInput.focus();
  }

  focusNextInput(event) {
    event.stopPropagation();
    if (document.activeElement === this.nameInput) {
      this.emailInput.focus();
    } else {
      this.nameInput.focus();
    }
  }

  focusPreviousInput(event) {
    event.stopPropagation();
    if (document.activeElement === this.emailInput) {
      this.nameInput.focus();
    } else {
      this.emailInput.focus();
    }
  }
}
