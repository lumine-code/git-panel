/** @babel */
import { CompositeDisposable } from "lumine";
import View, { h } from "../etch/view";
import { bindChildren } from "../etch/ownership";
import RefHolder from "../models/ref-holder";
import { extractProps } from "../helpers";
import { addLinterEditor } from "../linter-editors";
import { addAutocompleteEditor } from "../autocomplete-editors";

const updateProps = {
  mini: true,
  readOnly: true,
  placeholderText: true,
  lineNumberGutterVisible: true,
  showInvisibles: true,
  autoHeight: true,
  autoWidth: true,
  softWrapped: true,
  maxScreenLineLength: true,
  scrollPastEnd: true,
};
const controlledConfig = [
  "editor.showInvisibles",
  "editor.softWrap",
  "editor.maxScreenLineLength",
  "editor.scrollPastEnd",
];

export default class LumineTextEditor extends View {
  static defaultProps = {
    didChangeCursorPosition() {},
    didAddSelection() {},
    didChangeSelectionRange() {},
    didDestroySelection() {},
    hideEmptiness: false,
    preselect: false,
    tabIndex: 0,
  };
  constructor(props, children) {
    super(props, children);
    this.subs = new CompositeDisposable();
    this.refModel = this.props.refModel || new RefHolder();
    this.refElement = this.props.refElement || new RefHolder();
    this.editor = lumine.workspace.buildTextEditor(
      extractProps(this.props, { buffer: true, ...updateProps }),
    );
    this.refModel.setter(this.editor);
    this.refElement.setter(this.editor.getElement());
    this.initialize();
  }

  render() {
    return h(
      "span",
      { style: { display: "contents" } },
      h("div", { className: "git-panel-LumineTextEditor-container", ref: "container" }),
      bindChildren(this.props.children, { editor: this.refModel }),
    );
  }

  didMount() {
    const editor = this.editor;
    this.refs.container.appendChild(editor.getElement());
    if (this.props.preselect) editor.selectAll();
    if (this.props.registerWithLumine)
      this.subs.add(lumine.textEditors.add(editor, { role: "input" }));
    if (this.props.registerWithLinter) this.subs.add(addLinterEditor(editor));
    if (this.props.registerWithAutocomplete) this.subs.add(addAutocompleteEditor(editor));
    this.subs.add(
      editor.onDidChangeCursorPosition((event) => this.props.didChangeCursorPosition(event)),
      editor.observeSelections(this.observeSelections),
      editor.onDidChange(this.observeEmptiness),
      editor.onDidChangeGrammar(this.scheduleApplyEditorProps),
      lumine.config.onDidChangeConfiguration((event) => {
        if (controlledConfig.some((key) => event.affectsConfiguration(key)))
          this.scheduleApplyEditorProps();
      }),
    );
    this.applyEditorProps();
    this.scheduleApplyEditorProps();
  }

  didUpdate(previous) {
    if (previous.refModel !== this.props.refModel) {
      previous.refModel?.setter(null);
      this.props.refModel?.setter(this.editor);
    }
    if (previous.refElement !== this.props.refElement) {
      previous.refElement?.setter(null);
      this.props.refElement?.setter(this.editor.getElement());
    }
    this.applyEditorProps();
  }

  applyEditorProps = () => {
    if (this.destroyed || this.editor.isDestroyed()) return;
    this.editor.update(extractProps(this.props, updateProps));
    const element = this.editor.getElement();
    element.tabIndex = this.props.tabIndex;
    if (this.appliedClassName !== this.props.className) {
      if (this.appliedClassName)
        element.classList.remove(...this.appliedClassName.split(/\s+/).filter(Boolean));
      if (this.props.className)
        element.classList.add(...this.props.className.split(/\s+/).filter(Boolean));
      this.appliedClassName = this.props.className;
    }
    element.toggleAttribute("input", Boolean(this.props.input));
    this.observeEmptiness();
  };

  scheduleApplyEditorProps = () => {
    void lumine.packages.getActivatePromise().then(this.applyEditorProps);
  };

  observeSelections = (selection) => {
    if (this.destroyed) return;
    const subscriptions = new CompositeDisposable(
      selection.onDidChangeRange((event) => this.props.didChangeSelectionRange(event)),
      selection.onDidDestroy(() => {
        subscriptions.dispose();
        this.subs.remove(subscriptions);
        if (!this.destroyed) this.props.didDestroySelection(selection);
      }),
    );
    this.subs.add(subscriptions);
    this.props.didAddSelection(selection);
  };

  observeEmptiness = () => {
    if (this.destroyed || this.editor.isDestroyed()) return;
    this.editor
      .getElement()
      .classList.toggle(
        "git-panel-LumineTextEditor-empty",
        this.editor.isEmpty() && this.props.hideEmptiness,
      );
  };

  willDestroy() {
    this.subs.dispose();
    this.refModel.setter(null);
    this.refElement.setter(null);
    this.props.refModel?.setter(null);
    this.props.refElement?.setter(null);
    if (!this.editor.isDestroyed()) this.editor.destroy();
  }

  contains(element) {
    return this.editor.getElement().contains(element);
  }
  focus() {
    if (!this.destroyed) this.editor.getElement().focus();
  }
  getRefModel() {
    return this.props.refModel || this.refModel;
  }
  getRefElement() {
    return this.props.refElement || this.refElement;
  }
  getModel() {
    return this.editor;
  }
}
