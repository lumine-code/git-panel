/** @babel */
/** @jsx h */
import { View, h, Fragment } from "../etch/view";
import cx from "classnames";

import Commands, { Command } from "../lumine/commands";
import Panel from "../lumine/panel";
import { TabbableButton } from "./tabbable";

export default class DialogView extends View {
  constructor(props, children) {
    super(props, children);
    this.initialize();
  }

  static defaultProps = {
    acceptEnabled: true,
    acceptText: "Accept",
  };

  render() {
    return h(
      "span",
      { style: { display: "contents" } },
      <Panel workspace={this.props.workspace} location="modal">
        <div className="git-panel-Dialog">
          <Commands registry={this.props.commands} target=".git-panel-Dialog">
            <Command command="core:confirm" callback={this.props.accept} />
            <Command command="core:cancel" callback={this.props.cancel} />
          </Commands>
          {this.props.prompt && (
            <header className="git-panel-DialogPrompt">{this.props.prompt}</header>
          )}
          <main className="git-panel-DialogForm">{this.props.children}</main>
          <footer className="git-panel-DialogFooter">
            <div className="git-panel-DialogInfo">
              {this.props.progressMessage && this.props.inProgress && (
                <Fragment>
                  <span className="inline-block loading loading-spinner-small" />
                  <span className="git-panel-DialogProgress-message">
                    {this.props.progressMessage}
                  </span>
                </Fragment>
              )}
              {this.props.error && (
                <ul className="error-messages">
                  <li>{this.props.error.userMessage || this.props.error.message}</li>
                </ul>
              )}
            </div>
            <div className="git-panel-DialogButtons">
              <TabbableButton
                tabGroup={this.props.tabGroup}
                commands={this.props.commands}
                className="btn git-panel-Dialog-cancelButton"
                onClick={this.props.cancel}
              >
                Cancel
              </TabbableButton>
              <TabbableButton
                tabGroup={this.props.tabGroup}
                commands={this.props.commands}
                className={cx(
                  "btn btn-primary git-panel-Dialog-acceptButton",
                  this.props.acceptClassName,
                )}
                onClick={this.props.accept}
                disabled={this.props.inProgress || !this.props.acceptEnabled}
              >
                {this.props.acceptText}
              </TabbableButton>
            </div>
          </footer>
        </div>
      </Panel>,
    );
  }
}
