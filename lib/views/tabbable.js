/** @babel */
/** @jsx h */
import { View, h, Fragment } from "../etch/view.js";

import Commands, { Command } from "../lumine/commands.js";
import LumineTextEditor from "../lumine/lumine-text-editor.js";
import RefHolder from "../models/ref-holder.js";
import { unusedProps } from "../helpers.js";

export function makeTabbable(Component, options = {}) {
  return class extends View {
    static propTypes = {
      tabGroup: true,
      autofocus: true,
      commands: true,
      children: true,
    };

    static defaultProps = {
      autofocus: false,
    };

    constructor(props, children) {
      super(props, children);

      this.rootRef = new RefHolder();
      this.elementRef = new RefHolder();

      if (options.rootRefProp) {
        this.rootRef = new RefHolder();
        this.rootRefProps = { [options.rootRefProp]: this.rootRef };
      } else {
        this.rootRef = this.elementRef;
        this.rootRefProps = {};
      }

      if (options.passCommands) {
        this.commandProps = { commands: this.props.commands };
      } else {
        this.commandProps = {};
      }

      this.initialize();
    }

    render() {
      return h(
        "span",
        { style: { display: "contents" } },
        <Fragment>
          <Commands registry={this.props.commands} target={this.rootRef}>
            <Command command="core:focus-next" callback={this.focusNext} />
            <Command command="core:focus-previous" callback={this.focusPrevious} />
          </Commands>
          <Component
            ref={this.elementRef.setter}
            tabIndex={-1}
            {...unusedProps(this.props, this.constructor.propTypes)}
            {...this.rootRefProps}
            {...this.commandProps}
          >
            {this.props.children}
          </Component>
        </Fragment>,
      );
    }

    didMount() {
      this.elementRef.map((element) =>
        this.props.tabGroup.appendElement(element, this.props.autofocus),
      );
    }

    willDestroy() {
      this.elementRef.map((element) => this.props.tabGroup.removeElement(element));
    }

    focusNext = (e) => {
      this.elementRef.map((element) => this.props.tabGroup.focusAfter(element));
      e.stopPropagation();
    };

    focusPrevious = (e) => {
      this.elementRef.map((element) => this.props.tabGroup.focusBefore(element));
      e.stopPropagation();
    };
  };
}

export const TabbableInput = makeTabbable("input");

export const TabbableButton = makeTabbable("button");

export const TabbableSummary = makeTabbable("summary");

export const TabbableTextEditor = makeTabbable(LumineTextEditor, { rootRefProp: "refElement" });
