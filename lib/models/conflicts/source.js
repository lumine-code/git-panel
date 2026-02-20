/** @babel */
class Source {
  constructor(name, uiString, cssClass) {
    this.name = name.toLowerCase();

    this.uiString = uiString;
    this.cssClass = cssClass;
  }

  when(actions) {
    const chosen =
      actions[this.name] ||
      actions.default ||
      (() => {
        throw new Error(`Unexpected conflict side source: ${this.name}`);
      });
    return chosen();
  }

  getName() {
    return this.name;
  }

  getCSSClass() {
    return this.cssClass;
  }

  getBannerCSSClass() {
    return this.cssClass + "Banner";
  }

  getBlockCSSClass() {
    return this.cssClass + "Block";
  }

  toUIString() {
    return this.uiString;
  }

  toString() {
    return `<Source: ${this.name.toUpperCase()}>`;
  }
}

export const OURS = new Source("OURS", "our changes", "git-panel-ConflictOurs");
export const THEIRS = new Source("THEIRS", "their changes", "git-panel-ConflictTheirs");
export const BASE = new Source("BASE", "common ancestor", "git-panel-ConflictBase");
