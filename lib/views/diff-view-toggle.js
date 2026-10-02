/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";
import cx from "classnames";

export default class DiffViewToggle extends View {
  static defaultProps = { diffView: "unified" };

  constructor(props, children) {
    super(props, children);
    this.initialize();
  }

  render() {
    return (
      <div
        className="btn-group git-panel-DiffViewToggle"
        attributes={{ role: "group", "aria-label": "Diff view" }}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {[
          ["unified", "Unified"],
          ["side-by-side", "Side by Side"],
        ].map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            className={cx("btn", { selected: this.props.diffView === mode })}
            attributes={{
              "data-diff-view": mode,
              "aria-pressed": String(this.props.diffView === mode),
            }}
            onClick={() => this.props.onDiffViewChange(mode)}
          >
            {label}
          </button>
        ))}
      </div>
    );
  }
}
