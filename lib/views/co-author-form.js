/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";

import Author from "../models/author";
import Commands, { Command } from "../lumine/commands";
import { autobind } from "../helpers";

export default class CoAuthorForm extends View {
  static defaultProps = {
    onSubmit: () => {},
    onCancel: () => {},
  };

  constructor(props, children) {
    super(props, children);
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

    this.initialize();
  }

  didMount() {
    this.focusTimer = setTimeout(() => {
      if (!this.destroyed) this.focusFirstInput();
    });
  }

  willDestroy() {
    clearTimeout(this.focusTimer);
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
            onInput={this.onNameChange}
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
            onInput={this.onEmailChange}
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
    this.updateState({ name: e.target.value }, this.validate);
  }

  onEmailChange(e) {
    this.updateState({ email: e.target.value }, this.validate);
  }

  validate() {
    this.updateState({ submitDisabled: !this.isInputValid() });
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
