/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";
import Author from "../models/author";

let nextId = 0;

/** Native multi-author picker. Search and keyboard movement update this view alone. */
export default class CoAuthorSelect extends View {
  static defaultProps = { options: [], value: [], placeholder: "Co-Authors" };

  constructor(props, children) {
    super(props, children);
    this.state = { search: "", open: false, focused: 0 };
    this.menuId = `git-panel-co-author-${++nextId}`;
    this.initialize();
  }

  getOptions() {
    const selected = new Set((this.props.value || []).map((author) => author.getEmail()));
    const search = this.state.search.toLowerCase();
    const options = this.props.options.filter(
      (author) =>
        !selected.has(author.getEmail()) &&
        (!search ||
          [author.getFullName(), author.getEmail(), author.getLogin()].some((field) =>
            field?.toLowerCase().includes(search),
          )),
    );
    options.push(Author.createNew("Add new author", this.state.search));
    return options;
  }

  getFocusedAuthor() {
    const options = this.getOptions();
    return options[Math.min(this.state.focused, options.length - 1)];
  }

  selectAuthor = (author) => {
    const value = this.props.value || [];
    this.updateState({ search: "", open: false, focused: 0 });
    this.props.onChange?.([...value, author]);
  };

  removeAuthor = (author) => {
    this.props.onChange?.((this.props.value || []).filter((selected) => selected !== author));
  };

  inputChanged = (event) => {
    this.updateState({ search: event.target.value, focused: 0, open: true });
  };

  handleKey(keyCode, event) {
    const options = this.getOptions();
    let handled = true;
    if ([38, 40, 33, 34, 35, 36].includes(keyCode)) {
      const delta = keyCode === 38 ? -1 : keyCode === 40 ? 1 : keyCode === 33 ? -10 : 10;
      const focused =
        keyCode === 36
          ? 0
          : keyCode === 35
            ? options.length - 1
            : Math.max(
                0,
                Math.min(options.length - 1, this.state.focused + (this.state.open ? delta : 0)),
              );
      this.updateState({ open: true, focused });
      this.props.onFocusedAuthor?.(options[focused]);
    } else if ((keyCode === 13 || keyCode === 9) && this.state.open) {
      this.selectAuthor(this.getFocusedAuthor());
    } else if (keyCode === 27 && this.state.open) {
      this.updateState({ open: false });
    } else if (keyCode === 8 && !this.state.search && this.props.value?.length) {
      this.removeAuthor(this.props.value[this.props.value.length - 1]);
    } else {
      handled = false;
    }
    if (handled) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
    } else {
      event?.abortKeyBinding?.();
    }
    return handled;
  }

  keyDown = (event) => this.handleKey(event.keyCode || event.which, event);

  blur = (event) => {
    if (!this.element.contains(event.relatedTarget)) this.updateState({ open: false });
  };

  focus() {
    this.refs.input?.focus();
  }

  didUpdate() {
    if (this.state.open) {
      this.refs.focused?.scrollIntoView({ block: "nearest" });
    }
  }

  render() {
    const options = this.getOptions();
    const focused = Math.min(this.state.focused, options.length - 1);
    return (
      <div className={this.props.className} on={{ focusout: this.blur }}>
        <div className="Select__control">
          <div className="Select__value-container">
            {(this.props.value || []).map((author) => (
              <span key={author.getEmail()} className="Select__multi-value">
                {this.props.renderValue?.(author) || author.getFullName() || author.getEmail()}
                <button
                  className="Select__multi-value__remove"
                  type="button"
                  attributes={{
                    "aria-label": `Remove ${author.getFullName() || author.getEmail()}`,
                  }}
                  onClick={() => this.removeAuthor(author)}
                >
                  ×
                </button>
              </span>
            ))}
            <span className="Select__input-container">
              <input
                ref="input"
                type="text"
                value={this.state.search}
                placeholder={this.props.placeholder}
                tabIndex={this.props.tabIndex}
                attributes={{
                  role: "combobox",
                  "aria-label": "Co-authors",
                  "aria-autocomplete": "list",
                  "aria-expanded": this.state.open ? "true" : "false",
                  "aria-controls": this.menuId,
                  ...(this.state.open
                    ? { "aria-activedescendant": `${this.menuId}-${focused}` }
                    : {}),
                }}
                onInput={this.inputChanged}
                onKeyDown={this.keyDown}
              />
            </span>
          </div>
        </div>
        {this.state.open && (
          <div id={this.menuId} className="Select__menu" role="listbox">
            {options.map((author, index) => (
              <div
                key={author.getEmail()}
                id={`${this.menuId}-${index}`}
                attributes={{
                  role: "option",
                  "aria-selected": index === focused ? "true" : "false",
                }}
                ref={index === focused ? "focused" : null}
                className={`Select__option${index === focused ? " Select__option--is-focused" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => {
                  this.updateState({ focused: index });
                  this.props.onFocusedAuthor?.(author);
                }}
                onClick={() => this.selectAuthor(author)}
              >
                {this.props.renderOption?.(author) || author.getFullName() || "Add new author"}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
}
