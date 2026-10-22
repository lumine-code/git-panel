/** @babel */
/** @jsx h */
import { View, h } from "../etch/view.js";
import { CompositeDisposable } from "lumine";
import cx from "classnames";
import CoAuthorSelect from "./co-author-select.js";

import Tooltip from "../lumine/tooltip.js";
import LumineTextEditor from "../lumine/lumine-text-editor.js";
import CoAuthorForm from "./co-author-form.js";
import RecentCommitsView from "./recent-commits-view.js";
import Commands, { Command } from "../lumine/commands.js";
import RefHolder from "../models/ref-holder.js";

import ObserveModel from "./observe-model.js";
import { autobind } from "../helpers.js";

const TOOLTIP_DELAY = 200;

export default class CommitView extends View {
  static focus = {
    EDITOR: Symbol("commit-editor"),
    COAUTHOR_INPUT: Symbol("coauthor-input"),
    ABORT_MERGE_BUTTON: Symbol("commit-abort-merge-button"),
    COMMIT_BUTTON: Symbol("commit-button"),
  };

  static firstFocus = CommitView.focus.EDITOR;

  static lastFocus = Symbol("last-focus");

  constructor(props, children) {
    super(props, children);
    autobind(
      this,
      "submitNewCoAuthor",
      "cancelNewCoAuthor",
      "didMoveCursor",
      "toggleHardWrap",
      "toggleCoAuthorInput",
      "abortMerge",
      "commit",
      "amendLastCommit",
      "toggleExpandedCommitMessageEditor",
      "renderCoAuthorListItem",
      "onSelectedCoAuthorsChanged",
      "excludeCoAuthor",
      "updateCommitControls",
    );

    this.state = {
      showWorking: false,
      showCoAuthorInput: false,
      showCoAuthorForm: false,
      coAuthorInput: "",
    };

    this.timeoutHandle = null;
    this.subscriptions = new CompositeDisposable();

    this.refRoot = new RefHolder();
    this.refExpandButton = new RefHolder();
    this.refCommitButton = new RefHolder();
    this.refRemainingCharacters = new RefHolder();
    this.refHardWrapButton = new RefHolder();
    this.refAbortMergeButton = new RefHolder();
    this.refCoAuthorToggle = new RefHolder();
    this.refCoAuthorSelect = new RefHolder();
    this.refCoAuthorForm = new RefHolder();
    this.refEditorComponent = new RefHolder();
    this.refEditorModel = new RefHolder();

    this.subs = new CompositeDisposable();

    this.coAuthorSelectWrapper = null;
    this.focusedCoAuthor = null;
    this.messageIsValid = this.isValidMessage();
    this.messageHasBody = this.props.messageBuffer.getLineCount() > 1;

    this.initialize();
  }

  proxyKeyCode(keyCode) {
    return (event) => this.refCoAuthorSelect.map((picker) => picker.handleKey(keyCode, event));
  }

  didMount() {
    this.scheduleShowWorking(this.props);

    this.subs.add(
      this.props.config.onDidChange("git-panel.automaticCommitMessageWrapping", () =>
        this.invalidate(),
      ),
    );
    this.bindMessageBuffer();
  }

  render() {
    let remainingCharsClassName = "";
    const remainingCharacters = parseInt(this.getRemainingCharacters(), 10);
    if (remainingCharacters < 0) {
      remainingCharsClassName = "is-error";
    } else if (remainingCharacters < this.props.maximumCharacterLimit / 4) {
      remainingCharsClassName = "is-warning";
    }

    const showAbortMergeButton = this.props.isMerging || null;

    /* istanbul ignore next */
    const modKey = process.platform === "darwin" ? "Cmd" : "Ctrl";

    return (
      <div className="git-panel-CommitView" ref={this.refRoot.setter}>
        <Commands registry={this.props.commands} target="lumine-workspace">
          <Command
            command="git-panel:commit"
            description="Commit whatever is staged, with the message written above."
            isAvailable={() => this.commitIsEnabled(false)}
            callback={this.commit}
          />
          <Command
            command="git-panel:amend-last-commit"
            description="Fold the staged changes into the previous commit."
            isAvailable={() => this.commitIsEnabled(true)}
            callback={this.amendLastCommit}
          />
          <Command
            command="git-panel:toggle-co-authors"
            description="Show or hide the field for naming co-authors."
            callback={this.toggleCoAuthorInput}
          />
          <Command
            command="git-panel:toggle-expanded-commit-message-editor"
            description="Write the commit message in a full editor instead."
            description="Write the commit message in a full editor instead."
            callback={this.toggleExpandedCommitMessageEditor}
          />
        </Commands>
        <Commands registry={this.props.commands} target=".git-panel-CommitView-coAuthorEditor">
          <Command command="git-panel:selectbox-down" callback={this.proxyKeyCode(40)} />
          <Command command="git-panel:selectbox-up" callback={this.proxyKeyCode(38)} />
          <Command command="git-panel:selectbox-enter" callback={this.proxyKeyCode(13)} />
          <Command command="git-panel:selectbox-tab" callback={this.proxyKeyCode(9)} />
          <Command command="git-panel:selectbox-backspace" callback={this.proxyKeyCode(8)} />
          <Command command="git-panel:selectbox-pageup" callback={this.proxyKeyCode(33)} />
          <Command command="git-panel:selectbox-pagedown" callback={this.proxyKeyCode(34)} />
          <Command command="git-panel:selectbox-end" callback={this.proxyKeyCode(35)} />
          <Command command="git-panel:selectbox-home" callback={this.proxyKeyCode(36)} />
          <Command command="git-panel:selectbox-delete" callback={this.proxyKeyCode(46)} />
          <Command command="git-panel:selectbox-escape" callback={this.proxyKeyCode(27)} />
          <Command
            command="git-panel:co-author-exclude"
            description="Drop the co-author the cursor is on from the commit."
            callback={this.excludeCoAuthor}
          />
        </Commands>
        <div
          className={cx("git-panel-CommitView-editor", {
            "is-expanded": this.props.deactivateCommitBox,
          })}
        >
          <LumineTextEditor
            ref={this.refEditorComponent.setter}
            refModel={this.refEditorModel}
            className="git-panel-CommitView-messageEditor"
            softWrapped={true}
            placeholderText="Commit message"
            lineNumberGutterVisible={false}
            showInvisibles={false}
            autoHeight={false}
            scrollPastEnd={false}
            buffer={this.props.messageBuffer}
            workspace={this.props.workspace}
            didChangeCursorPosition={this.didMoveCursor}
            registerWithLumine={true}
            registerWithLinter={true}
            registerWithAutocomplete={true}
          />
          <button
            ref={this.refCoAuthorToggle.setter}
            className={cx("git-panel-CommitView-coAuthorToggle", {
              focused: this.state.showCoAuthorInput,
            })}
            onClick={this.toggleCoAuthorInput}
            attributes={{
              "aria-label": "Toggle co-authors",
              "aria-pressed": String(this.state.showCoAuthorInput),
            }}
          >
            {this.renderCoAuthorToggleIcon()}
          </button>
          <Tooltip
            manager={this.props.tooltips}
            target={this.refCoAuthorToggle}
            title={`${this.state.showCoAuthorInput ? "Remove" : "Add"} co-authors`}
            showDelay={TOOLTIP_DELAY}
          />
          <div className="git-panel-CommitView-editorControls">
            <button
              ref={this.refHardWrapButton.setter}
              onClick={this.toggleHardWrap}
              className="git-panel-CommitView-hardwrap hard-wrap-icons"
              attributes={{ "aria-label": "Toggle hard wrap on commit" }}
            >
              {this.renderHardWrapIcon()}
            </button>
            <Tooltip
              manager={this.props.tooltips}
              target={this.refHardWrapButton}
              className="git-panel-CommitView-hardwrap-tooltip"
              title="Toggle hard wrap on commit"
              showDelay={TOOLTIP_DELAY}
            />
            <div
              ref={this.refRemainingCharacters.setter}
              className={`git-panel-CommitView-remaining-characters ${remainingCharsClassName}`}
            >
              {this.getRemainingCharacters()}
            </div>
            <button
              ref={this.refExpandButton.setter}
              className="git-panel-CommitView-expandButton"
              onClick={this.toggleExpandedCommitMessageEditor}
              attributes={{ "aria-label": "Toggle expanded commit message editor" }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M5.5 2.5h-3v3m8-3h3v3m0 5v3h-3m-5 0h-3v-3" />
              </svg>
            </button>
            <Tooltip
              manager={this.props.tooltips}
              target={this.refExpandButton}
              className="git-panel-CommitView-expandButton-tooltip"
              title="Expand commit message editor"
              showDelay={TOOLTIP_DELAY}
            />
          </div>
        </div>

        {this.renderCoAuthorForm()}
        {this.renderCoAuthorInput()}

        <footer className="git-panel-CommitView-bar">
          {showAbortMergeButton && (
            <button
              ref={this.refAbortMergeButton.setter}
              className="btn git-panel-CommitView-button git-panel-CommitView-abortMerge is-secondary"
              onClick={this.abortMerge}
            >
              Abort Merge
            </button>
          )}

          <button
            ref={this.refCommitButton.setter}
            className="git-panel-CommitView-button git-panel-CommitView-commit btn btn-primary native-key-bindings"
            onClick={this.commit}
            disabled={!this.commitIsEnabled(false)}
          >
            {this.commitButtonText()}
          </button>
          <Tooltip
            manager={this.props.tooltips}
            target={this.refCommitButton}
            className="git-panel-CommitView-button-tooltip"
            title={`${modKey}-enter to commit`}
            showDelay={TOOLTIP_DELAY}
          />
        </footer>
      </div>
    );
  }

  renderCoAuthorToggleIcon() {
    return (
      <svg
        className="git-panel-CommitView-coAuthorToggleIcon"
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <circle cx="6" cy="5" r="2.5" />
        <path d="M1.5 13v-1a4.5 4.5 0 0 1 9 0v1M12.5 5.5v5m-2.5-2.5h5" />
      </svg>
    );
  }

  renderCoAuthorInput() {
    if (!this.state.showCoAuthorInput) {
      return null;
    }

    return (
      <ObserveModel model={this.props.userStore} fetchData={(store) => store.getUsers()}>
        {(mentionableUsers) => {
          const options = mentionableUsers || [];
          return (
            <div
              ref={(el) => {
                this.coAuthorSelectWrapper = el;
              }}
            >
              <CoAuthorSelect
                ref={this.refCoAuthorSelect.setter}
                className="git-panel-CommitView-coAuthorEditor input-textarea native-key-bindings"
                placeholder="Co-Authors"
                options={options}
                renderOption={this.renderCoAuthorListItem}
                renderValue={(author) => this.renderCoAuthorValue(author)}
                onChange={this.onSelectedCoAuthorsChanged}
                onFocusedAuthor={(author) => {
                  this.focusedCoAuthor = author;
                }}
                value={this.props.selectedCoAuthors}
                tabIndex={5}
              />
            </div>
          );
        }}
      </ObserveModel>
    );
  }

  renderHardWrapIcon() {
    const singleLineMessage = this.props.messageBuffer.getLineCount() === 1;
    const hardWrap = this.props.config.get("git-panel.automaticCommitMessageWrapping");
    const notApplicable = this.props.deactivateCommitBox || singleLineMessage;

    const svgPaths = {
      hardWrapEnabled: {
        path1:
          "M7.058 10.2h-.975v2.4L2 9l4.083-3.6v2.4h.97l1.202 1.203L7.058 10.2zm2.525-4.865V4.2h2.334v1.14l-1.164 1.165-1.17-1.17z",
        path2:
          "M7.842 6.94l2.063 2.063-2.122 2.12.908.91 2.123-2.123 1.98 1.98.85-.848L11.58 8.98l2.12-2.123-.824-.825-2.122 2.12-2.062-2.06z",
      },
      hardWrapDisabled: {
        path1: "M11.917 8.4c0 .99-.788 1.8-1.75 1.8H6.083v2.4L2 9l4.083-3.6v2.4h3.5V4.2h2.334v4.2z",
      },
    };

    if (notApplicable) {
      return null;
    }

    if (hardWrap) {
      return (
        <div
          className={cx("icon", "hardwrap", "icon-hardwrap-enabled", {
            hidden: notApplicable || !hardWrap,
          })}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
            <path d={svgPaths.hardWrapDisabled.path1} fillRule="evenodd" />
          </svg>
        </div>
      );
    } else {
      return (
        <div
          className={cx("icon", "no-hardwrap", "icon-hardwrap-disabled", {
            hidden: notApplicable || hardWrap,
          })}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
            <g fillRule="evenodd">
              <path d={svgPaths.hardWrapEnabled.path1} />
              <path fillRule="nonzero" d={svgPaths.hardWrapEnabled.path2} />
            </g>
          </svg>
        </div>
      );
    }
  }

  renderCoAuthorForm() {
    if (!this.state.showCoAuthorForm) {
      return null;
    }

    return (
      <CoAuthorForm
        ref={this.refCoAuthorForm.setter}
        commands={this.props.commands}
        onSubmit={this.submitNewCoAuthor}
        onCancel={this.cancelNewCoAuthor}
        name={this.state.coAuthorInput}
      />
    );
  }

  submitNewCoAuthor(newAuthor) {
    this.props.updateSelectedCoAuthors(this.props.selectedCoAuthors, newAuthor);
    this.hideNewAuthorForm();
  }

  cancelNewCoAuthor() {
    this.hideNewAuthorForm();
  }

  hideNewAuthorForm() {
    this.updateState({ showCoAuthorForm: false }, () => {
      this.refCoAuthorSelect.map((c) => c.focus());
    });
  }

  didUpdate(previousProps) {
    if (previousProps.messageBuffer !== this.props.messageBuffer) this.bindMessageBuffer();
    if (previousProps.isCommitting !== this.props.isCommitting) {
      this.scheduleShowWorking(this.props);
    }
  }

  willDestroy() {
    clearTimeout(this.timeoutHandle);
    this.timeoutHandle = null;
    this.subs.dispose();
  }

  didMoveCursor() {
    this.updateCommitControls();
  }

  updateCommitControls() {
    if (this.destroyed) return;
    const messageHasBody = this.props.messageBuffer.getLineCount() > 1;
    if (this.messageHasBody !== messageHasBody) {
      this.messageHasBody = messageHasBody;
      this.invalidate();
    }
    const commit = this.commitIsEnabled(false),
      amend = this.commitIsEnabled(true);
    if (this.commandAvailability?.commit !== commit || this.commandAvailability?.amend !== amend) {
      this.commandAvailability = { commit, amend };
      this.props.commands?.invalidateAvailability?.();
    }
    const remaining = this.getRemainingCharacters();
    const number = parseInt(remaining, 10);
    this.refRemainingCharacters.map((element) => {
      element.textContent = remaining;
      element.classList.toggle("is-error", number < 0);
      element.classList.toggle(
        "is-warning",
        number >= 0 && number < this.props.maximumCharacterLimit / 4,
      );
    });
    this.refCommitButton.map((button) => {
      button.disabled = !this.commitIsEnabled(false);
    });
  }

  toggleHardWrap() {
    const currentSetting = this.props.config.get("git-panel.automaticCommitMessageWrapping");
    this.props.config.set("git-panel.automaticCommitMessageWrapping", !currentSetting);
  }

  toggleCoAuthorInput() {
    this.updateState(
      {
        showCoAuthorInput: !this.state.showCoAuthorInput,
      },
      () => {
        if (this.state.showCoAuthorInput) {
          this.refCoAuthorSelect.map((c) => c.focus());
        } else {
          // if input is closed, remove all co-authors
          this.props.updateSelectedCoAuthors([]);
          this.refEditorComponent.map((c) => c.focus());
        }
      },
    );
  }

  excludeCoAuthor() {
    const author = this.focusedCoAuthor;
    if (!author || author.isNew()) {
      return;
    }

    let excluded = this.props.config.get("git-panel.excludedUsers");
    if (excluded && excluded !== "") {
      excluded += ", ";
    }
    excluded += author.getEmail();
    this.props.config.set("git-panel.excludedUsers", excluded);
  }

  abortMerge() {
    this.props.abortMerge();
  }

  async commit(event, amend) {
    if ((await this.props.prepareToCommit()) && this.commitIsEnabled(amend)) {
      try {
        await this.props.commit(
          this.props.messageBuffer.getText(),
          this.props.selectedCoAuthors,
          amend,
        );
      } catch (e) {
        // do nothing - error was taken care of in pipeline manager
        if (lumine.config.get("git-panel.debug")) {
          console.error(e);
        }
      }
    } else {
      this.setFocus(CommitView.focus.EDITOR);
    }
  }

  amendLastCommit() {
    this.commit(null, true);
  }

  getRemainingCharacters() {
    return this.refEditorModel
      .map((editor) => {
        if (editor.getCursorBufferPosition().row === 0) {
          return (
            this.props.maximumCharacterLimit - editor.lineTextForBufferRow(0).length
          ).toString();
        } else {
          return "∞";
        }
      })
      .getOr(this.props.maximumCharacterLimit || "");
  }

  // We don't want the user to see the UI flicker in the case
  // the commit takes a very small time to complete. Instead we
  // will only show the working message if we are working for longer
  // than 1 second as per https://www.nngroup.com/articles/response-times-3-important-limits/
  //
  // The closure is created to restrict variable access
  scheduleShowWorking(props) {
    if (props.isCommitting) {
      if (!this.state.showWorking && this.timeoutHandle === null) {
        this.timeoutHandle = setTimeout(() => {
          this.timeoutHandle = null;
          this.updateState({ showWorking: true });
        }, 1000);
      }
    } else {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
      this.updateState({ showWorking: false });
    }
  }

  isValidMessage() {
    // ensure that there are at least some non-comment lines in the commit message.
    // Commented lines are stripped out of commit messages by git, by default configuration.
    return this.props.messageBuffer.getText().replace(/^#.*$/gm, "").trim().length !== 0;
  }

  bindMessageBuffer() {
    if (this.messageSubscription) {
      this.subs.remove(this.messageSubscription);
      this.messageSubscription.dispose();
    }
    this.messageIsValid = this.isValidMessage();
    this.messageSubscription = this.props.messageBuffer.onDidChange(() => {
      this.messageIsValid = this.isValidMessage();
      this.updateCommitControls();
    });
    this.subs.add(this.messageSubscription);
    this.updateCommitControls();
  }

  commitIsEnabled(amend) {
    return Boolean(
      !this.props.isCommitting &&
      (amend || this.props.stagedChangesExist) &&
      !this.props.mergeConflictsExist &&
      this.props.lastCommit.isPresent() &&
      (!amend || !this.props.lastCommit.isUnbornRef?.()) &&
      (this.props.deactivateCommitBox || amend || this.messageIsValid),
    );
  }

  commitButtonText() {
    if (this.state.showWorking) {
      return "Working...";
    } else if (this.props.currentBranch.isDetached()) {
      return "Create detached commit";
    } else if (this.props.currentBranch.isPresent()) {
      return `Commit to ${this.props.currentBranch.getName()}`;
    } else {
      return "Commit";
    }
  }

  toggleExpandedCommitMessageEditor() {
    return this.props.toggleExpandedCommitMessageEditor(this.props.messageBuffer.getText());
  }

  renderCoAuthorListItemField(fieldName, value) {
    if (!value || value.length === 0) {
      return null;
    }

    return <span className={`git-panel-CommitView-coAuthorEditor-${fieldName}`}>{value}</span>;
  }

  renderCoAuthorListItem(author) {
    return (
      <div
        className={cx("git-panel-CommitView-coAuthorEditor-selectListItem", {
          "new-author": author.isNew(),
        })}
      >
        {this.renderCoAuthorListItemField("name", author.getFullName())}
        {author.hasLogin() && this.renderCoAuthorListItemField("login", "@" + author.getLogin())}
        {this.renderCoAuthorListItemField("email", author.getEmail())}
      </div>
    );
  }

  renderCoAuthorValue(author) {
    const fullName = author.getFullName();
    if (fullName && fullName.length > 0) {
      return <span>{author.getFullName()}</span>;
    }
    if (author.hasLogin()) {
      return <span>@{author.getLogin()}</span>;
    }

    return <span>{author.getEmail()}</span>;
  }

  onSelectedCoAuthorsChanged(selectedCoAuthors) {
    const newAuthor = selectedCoAuthors.find((author) => author.isNew());

    if (newAuthor) {
      this.updateState({ coAuthorInput: newAuthor.getFullName(), showCoAuthorForm: true });
    } else {
      this.props.updateSelectedCoAuthors(selectedCoAuthors);
    }
  }

  hasFocus() {
    return this.refRoot.map((element) => element.contains(document.activeElement)).getOr(false);
  }

  getFocus(element) {
    if (this.refEditorComponent.map((editor) => editor.contains(element)).getOr(false)) {
      return CommitView.focus.EDITOR;
    }

    if (this.refAbortMergeButton.map((e) => e.contains(element)).getOr(false)) {
      return CommitView.focus.ABORT_MERGE_BUTTON;
    }

    if (this.refCommitButton.map((e) => e.contains(element)).getOr(false)) {
      return CommitView.focus.COMMIT_BUTTON;
    }

    if (this.coAuthorSelectWrapper && this.coAuthorSelectWrapper.contains(element)) {
      return CommitView.focus.COAUTHOR_INPUT;
    }

    return null;
  }

  setFocus(focus) {
    let fallback = false;
    const focusElement = (element) => {
      element.focus();
      return true;
    };

    if (focus === CommitView.focus.EDITOR) {
      if (this.refEditorComponent.map(focusElement).getOr(false)) {
        if (this.props.messageBuffer.getText().length > 0 && !this.isValidMessage()) {
          // there is likely a commit message template present
          // we want the cursor to be at the beginning, not at the and of the template
          this.refEditorComponent.get().getModel().setCursorBufferPosition([0, 0]);
        }
        return true;
      }
    }

    if (focus === CommitView.focus.ABORT_MERGE_BUTTON) {
      if (this.refAbortMergeButton.map(focusElement).getOr(false)) {
        return true;
      }
      fallback = true;
    }

    if (focus === CommitView.focus.COMMIT_BUTTON) {
      if (this.refCommitButton.map(focusElement).getOr(false)) {
        return true;
      }
      fallback = true;
    }

    if (focus === CommitView.focus.COAUTHOR_INPUT) {
      if (this.refCoAuthorSelect.map(focusElement).getOr(false)) {
        return true;
      }
      fallback = true;
    }

    if (focus === CommitView.lastFocus) {
      if (this.state.showCoAuthorInput) {
        return this.setFocus(CommitView.focus.COAUTHOR_INPUT);
      } else {
        return this.setFocus(CommitView.focus.EDITOR);
      }
    }

    if (fallback && this.refEditorComponent.map(focusElement).getOr(false)) {
      return true;
    }

    return false;
  }

  advanceFocusFrom(focus) {
    const f = this.constructor.focus;

    let next = null;
    switch (focus) {
      case f.EDITOR:
        if (this.state.showCoAuthorInput) {
          next = f.COAUTHOR_INPUT;
        } else {
          next = RecentCommitsView.firstFocus;
        }
        break;
      case f.COAUTHOR_INPUT:
        next = RecentCommitsView.firstFocus;
        break;
    }

    return Promise.resolve(next);
  }

  retreatFocusFrom(focus) {
    const f = this.constructor.focus;

    let previous = null;
    switch (focus) {
      case f.COAUTHOR_INPUT:
        previous = f.EDITOR;
        break;
    }

    return Promise.resolve(previous);
  }
}
