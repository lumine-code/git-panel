/** @babel */
/** @jsx h */
import { View, h, Fragment } from "../etch/view.js";
import cx from "classnames";

import Commands, { Command } from "../lumine/commands.js";
import Panel from "../lumine/panel.js";
import { TabbableButton } from "./tabbable.js";

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
      <Panel
        workspace={this.props.workspace}
        location="modal"
        options={{
          className: "dialog-panel",
          autoFocus: true,
          dismissOnBlur: () => !this.props.inProgress,
        }}
        onDidChangeVisible={(visible, panel) => {
          if (
            !visible &&
            !panel.destroyed &&
            !panel.flowTransition &&
            !this.destroyed &&
            !this.props.inProgress
          )
            this.props.cancel();
        }}
      >
        <div
          className="git-panel-Dialog dialog-form"
          role="dialog"
          attributes={{
            "aria-label": this.props.prompt || this.props.acceptText,
            "aria-busy": String(Boolean(this.props.inProgress)),
          }}
        >
          <Commands registry={this.props.commands} target=".git-panel-Dialog">
            <Command
              command="core:confirm"
              isAvailable={() => Boolean(this.props.acceptEnabled && !this.props.inProgress)}
              callback={() => {
                if (this.props.acceptEnabled && !this.props.inProgress) return this.props.accept();
              }}
            />
            <Command
              command="core:cancel"
              isAvailable={() => !this.props.inProgress}
              callback={() => {
                if (!this.props.inProgress) this.props.cancel();
              }}
            />
          </Commands>
          {this.props.prompt && (
            <header className="dialog-header">
              <h1 className="git-panel-DialogPrompt dialog-title">{this.props.prompt}</h1>
            </header>
          )}
          <main className="git-panel-DialogForm dialog-body">{this.props.children}</main>
          <div className="git-panel-DialogInfo dialog-status" role="status">
            {this.props.progressMessage && this.props.inProgress && (
              <Fragment>
                <span className="inline-block loading loading-spinner-small" />
                <span className="git-panel-DialogProgress-message">
                  {this.props.progressMessage}
                </span>
              </Fragment>
            )}
            {this.props.error && (
              <div className="text-error">
                {this.props.error.userMessage || this.props.error.message}
              </div>
            )}
          </div>
          <footer className="git-panel-DialogFooter dialog-footer">
            <div className="git-panel-DialogButtons dialog-actions">
              <TabbableButton
                tabGroup={this.props.tabGroup}
                commands={this.props.commands}
                className="btn git-panel-Dialog-cancelButton"
                onClick={this.props.cancel}
                disabled={this.props.inProgress}
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
