/** @babel */
import { CompositeDisposable } from "lumine";
import View, { h, mount } from "../etch/view.js";
import { createItem } from "../helpers.js";

export default class Panel extends View {
  static defaultProps = { options: {}, onDidClosePanel() {}, onDidChangeVisible() {} };
  constructor(props, children) {
    super(props, children);
    this.subscriptions = new CompositeDisposable();
    this.domNode = document.createElement("div");
    this.domNode.className = "git-panel-Panel";
    this.panel = null;
    this.initialize();
  }
  render() {
    return h("span", { hidden: true });
  }
  didMount() {
    this.contentView = mount(this.props.children, this.domNode);
    this.setupPanel();
  }
  didUpdate(previous) {
    this.contentView.update(this.props.children);
    if (previous.location !== this.props.location || previous.workspace !== this.props.workspace) {
      this.subscriptions.dispose();
      this.subscriptions = new CompositeDisposable();
      this.panel?.destroy();
      this.panel = null;
      this.setupPanel();
    }
  }
  setupPanel() {
    const location = this.props.location[0].toUpperCase() + this.props.location.slice(1);
    this.panel = this.props.workspace["add" + location + "Panel"]({
      ...this.props.options,
      item: createItem(this.domNode, this.props.itemHolder),
    });
    this.subscriptions.add(
      this.panel.onDidChangeVisible((visible) => {
        if (!this.destroyed) this.props.onDidChangeVisible(visible, this.panel);
      }),
      this.panel.onDidDestroy(() => {
        this.didCloseItem = true;
        if (!this.destroyed) this.props.onDidClosePanel(this.panel);
      }),
    );
  }
  willDestroy() {
    this.subscriptions.dispose();
    this.contentView?.destroy();
    this.panel?.destroy();
    this.domNode.remove();
  }
  getPanel() {
    return this.panel;
  }
}
