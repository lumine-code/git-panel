/** @babel */
import { Disposable } from "lumine";
import View, { h, mount } from "../etch/view";
import { holder } from "../etch/ownership";
import { createItem } from "../helpers";

const verbatim = [
  "title",
  "html",
  "placement",
  "trigger",
  "keyBindingCommand",
  "keyBindingExtra",
  "keyBindingTarget",
];
const optionNames = [
  ...verbatim,
  "entries",
  "tooltips",
  "className",
  "showDelay",
  "hideDelay",
  "target",
  "manager",
];
export default class Tooltip extends View {
  constructor(props, children) {
    super(props, children);
    this.refSub = new Disposable();
    this.tipSub = new Disposable();
    this.domNode = document.createElement("div");
    this.domNode.className = "git-panel-Tooltip";
    this.initialize();
  }
  render() {
    return h("span", { hidden: true });
  }
  hasContent() {
    return (
      typeof this.props.children === "function" ||
      (Array.isArray(this.props.children)
        ? this.props.children.length > 0
        : this.props.children != null)
    );
  }
  didMount() {
    if (this.hasContent()) this.contentView = mount(this.props.children, this.domNode);
    this.setupTooltip();
  }
  didUpdate(previous) {
    const hadContent = Boolean(this.contentView);
    if (this.hasContent()) {
      if (this.contentView) this.contentView.update(this.props.children);
      else this.contentView = mount(this.props.children, this.domNode);
    } else {
      this.contentView?.destroy();
      this.contentView = null;
    }
    if (
      hadContent !== Boolean(this.contentView) ||
      optionNames.some((key) => previous[key] !== this.props[key])
    )
      this.setupTooltip();
  }
  setupTooltip() {
    this.refSub.dispose();
    this.tipSub.dispose();
    const options = {};
    for (const key of verbatim) if (this.props[key] !== undefined) options[key] = this.props[key];
    if (this.props.className !== undefined) options.class = this.props.className;
    if (this.props.showDelay !== undefined || this.props.hideDelay !== undefined) {
      const hover = this.props.trigger === "hover" || this.props.trigger === undefined;
      options.delay = {
        show: this.props.showDelay ?? (hover ? 1000 : 0),
        hide: this.props.hideDelay ?? (hover ? 100 : 0),
      };
    }
    if (this.contentView) options.item = createItem(this.domNode, this.props.itemHolder);
    this.refSub = holder(this.props.target).observe((target) => {
      if (this.destroyed) return;
      this.tipSub.dispose();
      this.tipSub =
        this.props.entries !== undefined
          ? this.props.manager.addComposite(
              target,
              this.props.entries.map((entry, index) =>
                index === 0 ? { ...options, ...entry } : entry,
              ),
            )
          : this.props.manager.add(target, options);
      this.props.tooltipHolder?.setter(this.tipSub);
    });
  }
  willDestroy() {
    this.refSub.dispose();
    this.tipSub.dispose();
    this.contentView?.destroy();
    this.props.tooltipHolder?.setter(null);
    this.domNode.remove();
  }
}
