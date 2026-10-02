/** @babel */
import { CompositeDisposable, Disposable, Range } from "lumine";
import View, { h } from "../etch/view";
import { holder, bindChildren } from "../etch/ownership";
import RefHolder from "../models/ref-holder";
import { extractProps } from "../helpers";

const markerProps = { exclusive: true, reversed: true, invalidate: true };
export default class Marker extends View {
  static defaultProps = { onDidChange() {}, handleMarker() {}, handleID() {} };
  constructor(props, children) {
    super(props, children);
    this.markerHolder = new RefHolder();
    this.markableHolder = holder(this.props.layer || this.props.editor);
    this.markableSub = new Disposable();
    this.markerSubs = new CompositeDisposable();
    this.initialize();
  }

  render() {
    return h(
      "span",
      { style: { display: "contents" } },
      bindChildren(this.props.children, {
        editor: this.props.editor,
        decorable: this.markerHolder,
        decorateMethod: "decorateMarker",
      }),
    );
  }

  didMount() {
    this.observeMarkable();
  }
  didUpdate(previous) {
    if (
      previous.layer !== this.props.layer ||
      previous.editor !== this.props.editor ||
      previous.id !== this.props.id
    )
      this.observeMarkable();
    this.markerHolder.map((marker) => {
      if (marker.isDestroyed()) return;
      if (Object.keys(markerProps).some((key) => previous[key] !== this.props[key]))
        marker.setProperties(extractProps(this.props, markerProps));
      if (this.props.bufferRange && previous.bufferRange !== this.props.bufferRange)
        marker.setBufferRange(this.props.bufferRange);
    });
  }

  observeMarkable() {
    this.markableSub.dispose();
    this.markableHolder = holder(this.props.layer || this.props.editor);
    this.markableSub = this.markableHolder.observe((markable) => {
      if (this.destroyed || markable.isDestroyed()) return;
      this.markerSubs.dispose();
      this.markerSubs = new CompositeDisposable();
      const options = extractProps(this.props, markerProps);
      let marker;
      if (this.props.id !== undefined) {
        marker = markable.getMarker(this.props.id);
        if (!marker) throw new Error("Invalid marker ID: " + this.props.id);
        marker.setProperties(options);
      } else {
        marker = markable.markBufferRange(this.props.bufferRange, options);
        this.markerSubs.add(
          new Disposable(() => {
            if (!marker.isDestroyed()) marker.destroy();
          }),
        );
      }
      this.markerSubs.add(marker.onDidChange(this.didChange));
      this.markerHolder.setter(marker);
      this.props.handleMarker(marker);
      this.props.handleID(marker.id);
    });
  }

  didChange = (event) => {
    if (this.destroyed) return;
    const reversed = this.markerHolder.map((marker) => marker.isReversed()).getOr(false);
    this.props.onDidChange({
      ...event,
      oldRange: new Range(
        reversed ? event.oldHeadBufferPosition : event.oldTailBufferPosition,
        reversed ? event.oldTailBufferPosition : event.oldHeadBufferPosition,
      ),
      newRange: new Range(
        reversed ? event.newHeadBufferPosition : event.newTailBufferPosition,
        reversed ? event.newTailBufferPosition : event.newHeadBufferPosition,
      ),
    });
  };

  willDestroy() {
    this.markableSub.dispose();
    this.markerSubs.dispose();
    this.markerHolder.setter(null);
    this.props.handleMarker(undefined);
    this.props.handleID(undefined);
  }
}
