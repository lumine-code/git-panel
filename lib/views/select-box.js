/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";

export default class SelectBox extends View {
  constructor(props, children) {
    super(props, children);
    this.initialize();
  }

  didMount() {
    this.controller = lumine.menu.createSelectBox({
      items: this.props.items || [],
      value: this.props.value,
      disabled: Boolean(this.props.disabled),
      ariaLabel: this.props.ariaLabel,
      className: this.props.className,
      onWillOpen: (controller) => this.props.onWillOpen?.(controller),
    });
    this.changeSubscription = this.controller.onDidChange((event) => {
      this.props.onDidChange?.(event);
    });
    this.host.appendChild(this.controller.element);
  }

  didUpdate() {
    this.controller.setItems(this.props.items || [], { value: this.props.value });
    if (this.props.value !== undefined) this.controller.setValue(this.props.value);
    this.controller.setEnabled(!this.props.disabled);
  }

  willDestroy() {
    this.changeSubscription?.dispose();
    this.controller?.destroy();
  }

  get value() {
    return this.controller?.value;
  }

  get items() {
    return this.props.items || [];
  }

  setValue(value, options) {
    return this.controller?.setValue(value, options);
  }

  selectNext(options) {
    return this.controller?.selectNext(options);
  }

  selectPrevious(options) {
    return this.controller?.selectPrevious(options);
  }

  focus() {
    this.controller?.focus();
  }

  render() {
    return <span ref={(element) => (this.host = element)} style={{ display: "contents" }} />;
  }
}
