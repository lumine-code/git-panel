/** @babel */
/** @jsx React.createElement */
import React, { Fragment } from "react";
import { CompositeDisposable } from "lumine";

import RefHolder from "../models/ref-holder";
import { extractProps } from "../helpers";
import { addLinterEditor } from "../linter-editors";
import { addAutocompleteEditor } from "../autocomplete-editors";

const editorUpdateProps = {
  mini: true,
  readOnly: true,
  placeholderText: true,
  lineNumberGutterVisible: true,
  showInvisibles: true,
  autoHeight: true,
  autoWidth: true,
  softWrapped: true,
  scrollPastEnd: true,
};

const editorCreationProps = {
  buffer: true,
  ...editorUpdateProps,
};

const EMPTY_CLASS = "git-panel-LumineTextEditor-empty";

const configKeysForControlledProps = [
  "editor.showInvisibles",
  "editor.softWrap",
  "editor.scrollPastEnd",
];

export const TextEditorContext = React.createContext();

export default class LumineTextEditor extends React.Component {
  static defaultProps = {
    didChangeCursorPosition: () => {},
    didAddSelection: () => {},
    didChangeSelectionRange: () => {},
    didDestroySelection: () => {},

    hideEmptiness: false,
    preselect: false,
    tabIndex: 0,
  };

  constructor(props) {
    super(props);

    this.subs = new CompositeDisposable();

    this.refParent = new RefHolder();
    this.refElement = null;
    this.refModel = null;
  }

  render() {
    return (
      <Fragment>
        <div className="git-panel-LumineTextEditor-container" ref={this.refParent.setter} />
        <TextEditorContext.Provider value={this.getRefModel()}>
          {this.props.children}
        </TextEditorContext.Provider>
      </Fragment>
    );
  }

  componentDidMount() {
    const modelProps = extractProps(this.props, editorCreationProps);

    this.refParent.map((element) => {
      const editor = lumine.workspace.buildTextEditor(modelProps);
      editor.getElement().tabIndex = this.props.tabIndex;
      if (this.props.className) {
        editor.getElement().classList.add(this.props.className);
      }
      if (this.props.preselect) {
        editor.selectAll();
      }
      element.appendChild(editor.getElement());
      this.getRefModel().setter(editor);
      this.getRefElement().setter(editor.getElement());

      this.applyEditorProps();
      this.scheduleApplyEditorProps();

      if (this.props.registerWithLumine) {
        this.subs.add(lumine.textEditors.add(editor, { role: "input" }));
      }
      // Only pane items are linted on their own; an editor holding something a
      // person writes — the commit box — is registered with the linter by us.
      if (this.props.registerWithLinter) {
        this.subs.add(addLinterEditor(editor));
      }
      // Same for completions: autocomplete only watches pane items, so an
      // editor that wants the suggestion overlay is handed over by us.
      if (this.props.registerWithAutocomplete) {
        this.subs.add(addAutocompleteEditor(editor));
      }

      this.subs.add(
        editor.onDidChangeCursorPosition(this.props.didChangeCursorPosition),
        editor.observeSelections(this.observeSelections),
        editor.onDidChange(this.observeEmptiness),
        editor.onDidChangeGrammar(this.scheduleApplyEditorProps),
      );

      this.subs.add(
        lumine.config.onDidChangeConfiguration((event) => {
          if (configKeysForControlledProps.some((key) => event.affectsConfiguration(key))) {
            this.scheduleApplyEditorProps();
          }
        }),
      );

      if (editor.isEmpty() && this.props.hideEmptiness) {
        editor.getElement().classList.add(EMPTY_CLASS);
      }

      return null;
    });
  }

  componentDidUpdate() {
    this.applyEditorProps();

    // When you look into the abyss, the abyss also looks into you
    this.observeEmptiness();
  }

  componentWillUnmount() {
    this.getRefModel().map((editor) => editor.destroy());
    this.subs.dispose();
  }

  applyEditorProps = () => {
    const modelProps = extractProps(this.props, editorUpdateProps);
    this.getRefModel().map((editor) => {
      if (!editor.isDestroyed()) {
        editor.update(modelProps);
      }
      return null;
    });
  };

  scheduleApplyEditorProps = () => {
    // buildTextEditor maintains config after initial package activation and on
    // later config or grammar changes. Its continuation is registered first,
    // so this restores the explicit React props after that pass has finished.
    void lumine.packages.getActivatePromise().then(this.applyEditorProps);
  };

  observeSelections = (selection) => {
    const selectionSubs = new CompositeDisposable(
      selection.onDidChangeRange(this.props.didChangeSelectionRange),
      selection.onDidDestroy(() => {
        selectionSubs.dispose();
        this.subs.remove(selectionSubs);
        this.props.didDestroySelection(selection);
      }),
    );
    this.subs.add(selectionSubs);
    this.props.didAddSelection(selection);
  };

  observeEmptiness = () => {
    this.getRefModel().map((editor) => {
      if (editor.isEmpty() && this.props.hideEmptiness) {
        this.getRefElement().map((element) => element.classList.add(EMPTY_CLASS));
      } else {
        this.getRefElement().map((element) => element.classList.remove(EMPTY_CLASS));
      }
      return null;
    });
  };

  contains(element) {
    return this.getRefElement()
      .map((e) => e.contains(element))
      .getOr(false);
  }

  focus() {
    this.getRefElement().map((e) => e.focus());
  }

  getRefModel() {
    if (this.props.refModel) {
      return this.props.refModel;
    }

    if (!this.refModel) {
      this.refModel = new RefHolder();
    }

    return this.refModel;
  }

  getRefElement() {
    if (this.props.refElement) {
      return this.props.refElement;
    }

    if (!this.refElement) {
      this.refElement = new RefHolder();
    }

    return this.refElement;
  }

  getModel() {
    return this.getRefModel().getOr(undefined);
  }
}
