/** @babel */
/** @jsx h */
import { View, h } from "../etch/view.js";
import { imageMimeType, imageEndpoints } from "../image-patch.js";

const sides = ["old", "new"];
const titles = { old: "Old", new: "New" };

// Each mounted preview owns its reads and Blob URLs. A refreshed patch always
// reads again, including image changes whose empty text diff stays identical.
export default class ImagePatchView extends View {
  static defaultProps = { layout: "unified" };

  constructor(props) {
    super(props);
    this.urls = new Set();
    this.state = this.initialState();
    this.initialize();
  }

  initialState() {
    return {
      position: 50,
      ...Object.fromEntries(
        sides.map((side) => {
          const file = this.file(side);
          return [
            side,
            {
              status: !file.isPresent()
                ? "absent"
                : imageMimeType(file)
                  ? "loading"
                  : "unsupported",
            },
          ];
        }),
      ),
    };
  }

  file(side) {
    return side === "old" ? this.props.filePatch.getOldFile() : this.props.filePatch.getNewFile();
  }

  didMount() {
    this.windowParticipant = lumine.views.addWindowParticipant(this.element, this);
    this.bindSizeObserver();
    this.load();
  }

  prepareWindowChange() {
    this.stopDragging();
  }

  didAttachToWindow() {
    this.bindSizeObserver();
    this.scheduleSize();
  }

  bindSizeObserver() {
    if (this.destroyed) return;
    const window = this.element.ownerDocument.defaultView;
    if (this.resizeWindow === window) return;
    this.resizeObserver?.disconnect();
    this.resizeWindow = window;
    const observer = new window.ResizeObserver(() => {
      if (this.resizeObserver === observer) this.scheduleSize();
    });
    this.resizeObserver = observer;
    observer.observe(this.element);
    this.observedContainer = this.element.closest(".git-panel-FilePatchView-container");
    if (this.observedContainer) observer.observe(this.observedContainer);
  }

  didUpdate() {
    const container = this.element.closest(".git-panel-FilePatchView-container");
    if (container !== this.observedContainer) {
      if (this.observedContainer) this.resizeObserver.unobserve(this.observedContainer);
      this.observedContainer = container;
      if (container) this.resizeObserver.observe(container);
    }
    this.scheduleSize();
  }

  scheduleSize() {
    if (this.sizePending || this.destroyed) return;
    this.sizePending = true;
    lumine.views.updateDocument(() => {
      this.sizePending = false;
      if (!this.destroyed) this.measureSize();
    });
  }

  measureSize() {
    if (!this.element.isConnected) return;
    const images = sides
      .map((side) => this.state[side])
      .filter((state) => state.status === "ready");
    const viewports = Array.from(
      this.element.querySelectorAll(
        ".git-panel-ImagePatchView-viewport, .git-panel-ImagePatchView-preview",
      ),
    );
    if (!images.length || !viewports.length) return;
    const width = Math.max(...images.map((state) => state.width));
    const height = Math.max(...images.map((state) => state.height));
    const padding = (node, axis) => {
      const style = node.ownerDocument.defaultView.getComputedStyle(node);
      return axis === "x"
        ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
        : parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    };
    const availableWidth = Math.min(
      ...viewports.map((node) => node.clientWidth - padding(node, "x")),
    );
    const container = this.observedContainer;
    const block = this.element.closest(".git-panel-FilePatchView-controlBlock");
    const elementStyle = this.element.ownerDocument.defaultView.getComputedStyle(this.element);
    const outside = block
      ? block.getBoundingClientRect().height - this.element.getBoundingClientRect().height
      : 0;
    const renderedImages = Array.from(this.element.querySelectorAll("img"));
    if (!renderedImages.length) return;
    const imageHeight = Math.max(
      ...renderedImages.map((node) => node.getBoundingClientRect().height),
    );
    // Subtract all surrounding UI, including status rows in one-sided previews.
    // The image's own height cancels out, so fitting stays stable across resizes.
    const surroundingHeight = this.element.getBoundingClientRect().height - imageHeight;
    const availableHeight = Math.max(
      1,
      (container?.clientHeight || this.element.ownerDocument.defaultView.innerHeight) -
        outside -
        surroundingHeight -
        (block ? 0 : parseFloat(elementStyle.marginTop) + parseFloat(elementStyle.marginBottom)),
    );
    const scale = Math.min(1, availableWidth / width, availableHeight / height);
    if (scale > 0 && Math.abs(scale - (this.state.scale ?? 0)) > 0.000001)
      this.updateState({ scale });
  }

  update(props) {
    if (this.destroyed) return Promise.resolve();
    if (props.layout !== this.props.layout) this.stopDragging();
    const changed =
      props.filePatch !== this.props.filePatch ||
      props.repository !== this.props.repository ||
      props.document !== this.props.document ||
      props.commit !== this.props.commit;
    if (changed) {
      this.rememberPrevious();
      const position = this.state.position;
      const preservePosition =
        props.document === this.props.document &&
        props.repository === this.props.repository &&
        props.filePatch.getOldPath() === this.props.filePatch.getOldPath() &&
        props.filePatch.getNewPath() === this.props.filePatch.getNewPath();
      this.release();
      this.props = this.resolveProps(props);
      this.state = this.initialState();
      if (preservePosition) this.state.position = position;
    }
    const update = super.update(props);
    if (changed && !this.destroyed) this.load();
    return update;
  }

  load() {
    const request = (this.request = new AbortController());
    const endpoints = imageEndpoints(this.props.document, this.props.commit);
    this.loading = Promise.all(
      sides.map(async (side) => {
        if (this.state[side].status !== "loading") return;
        const file = this.file(side);
        let url;
        try {
          const contents = await this.props.repository.readFileAtEndpoint(
            file.getPath(),
            endpoints[side].endpoint,
            { signal: request.signal },
          );
          if (this.destroyed || request.signal.aborted || this.request !== request) return;
          if (contents === null) {
            await this.updateState({ [side]: { status: "unavailable" } });
            return;
          }
          url = URL.createObjectURL(new Blob([contents], { type: imageMimeType(file) }));
          this.urls.add(url);
          const image = new Image();
          image.src = url;
          await image.decode();
          if (this.destroyed || request.signal.aborted || this.request !== request) return;
          await this.updateState({
            [side]: {
              status: "ready",
              url,
              width: image.naturalWidth,
              height: image.naturalHeight,
            },
          });
        } catch {
          if (url && this.urls.delete(url)) URL.revokeObjectURL(url);
          if (!this.destroyed && !request.signal.aborted && this.request === request)
            await this.updateState({ [side]: { status: "error" } });
        }
      }),
    );
  }

  didLoadImage(side, url, event) {
    if (this.destroyed || this.state[side].url !== url) return;
    const image = event.target;
    if (
      this.state[side].width === image.naturalWidth &&
      this.state[side].height === image.naturalHeight
    )
      return;
    this.updateState({
      [side]: { ...this.state[side], width: image.naturalWidth, height: image.naturalHeight },
    });
  }

  didFailImage(side, url) {
    if (this.destroyed || this.state[side].url !== url) return;
    this.stopDragging();
    URL.revokeObjectURL(url);
    this.urls.delete(url);
    this.updateState({ [side]: { status: "error" } });
  }

  renderSide(side) {
    const state = this.state[side];
    const source = imageEndpoints(this.props.document, this.props.commit)[side];
    return (
      <figure className="git-panel-ImagePatchView-side" dataset={{ side }}>
        <figcaption>
          <strong>{titles[side]}</strong>
          <span>{source.label}</span>
          {state.width > 0 && (
            <span className="git-panel-ImagePatchView-dimensions">
              {state.width} × {state.height}
            </span>
          )}
        </figcaption>
        <div
          className={`git-panel-ImagePatchView-preview${state.status === "ready" ? " git-panel-ImagePatchView-preview--ready" : ""}`}
          attributes={{ "aria-live": "polite" }}
        >
          {state.status === "ready" ? (
            <img
              key={state.url}
              src={state.url}
              alt={`${titles[side]}: ${this.file(side).getPath()}`}
              draggable={false}
              style={
                this.state.scale
                  ? {
                      width: `${state.width * this.state.scale}px`,
                      height: `${state.height * this.state.scale}px`,
                    }
                  : {}
              }
              onLoad={(event) => this.didLoadImage(side, state.url, event)}
              onError={() => this.didFailImage(side, state.url)}
            />
          ) : (
            <p>{this.statusMessage(side)}</p>
          )}
        </div>
      </figure>
    );
  }

  setPosition(position) {
    this.updateState({ position: Math.max(0, Math.min(100, position)) });
  }

  moveFromPointer(event) {
    const bounds = this.refs.stage.getBoundingClientRect();
    if (bounds.width > 0) this.setPosition((100 * (event.clientX - bounds.left)) / bounds.width);
  }

  didPointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    this.dragPointerId = event.pointerId;
    this.dragElement = event.currentTarget;
    this.dragElement.setPointerCapture(event.pointerId);
    this.moveFromPointer(event);
  };

  didPointerMove = (event) => {
    if (this.dragPointerId !== event.pointerId) return;
    event.preventDefault();
    this.moveFromPointer(event);
  };

  didPointerUp = (event) => {
    if (this.dragPointerId === event.pointerId) this.stopDragging();
  };

  stopDragging() {
    if (this.dragElement?.hasPointerCapture(this.dragPointerId))
      this.dragElement.releasePointerCapture(this.dragPointerId);
    this.dragPointerId = null;
    this.dragElement = null;
  }

  didKeyDown = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? 10 : 1;
    const positions = {
      ArrowLeft: this.state.position - step,
      ArrowDown: this.state.position - step,
      ArrowRight: this.state.position + step,
      ArrowUp: this.state.position + step,
      PageDown: this.state.position - 10,
      PageUp: this.state.position + 10,
      Home: 0,
      End: 100,
    };
    if (!Object.hasOwn(positions, event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    this.setPosition(positions[event.key]);
  };

  didMouseDown = (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    this.setPosition(this.state.position === 100 ? 0 : 100);
  };

  renderComparisonImage(side, width, height) {
    const state = this.state[side];
    return (
      <img
        key={state.url}
        src={state.url}
        alt={`${titles[side]}: ${this.file(side).getPath()}`}
        draggable={false}
        style={{
          width: `${(100 * state.width) / width}%`,
          height: `${(100 * state.height) / height}%`,
        }}
        onError={() => this.didFailImage(side, state.url)}
      />
    );
  }

  renderComparison() {
    const width = Math.max(this.state.old.width, this.state.new.width);
    const height = Math.max(this.state.old.height, this.state.new.height);
    const sources = imageEndpoints(this.props.document, this.props.commit);
    return (
      <div className="git-panel-ImagePatchView-comparison">
        <div className="git-panel-ImagePatchView-captions">
          {sides.map((side) => (
            <span>
              <strong>{titles[side]}</strong> {sources[side].label} · {this.state[side].width} ×{" "}
              {this.state[side].height}
            </span>
          ))}
        </div>
        <div className="git-panel-ImagePatchView-viewport">
          <div
            className="git-panel-ImagePatchView-stage"
            ref="stage"
            style={{
              width: `${width * (this.state.scale ?? 1)}px`,
              height: `${height * (this.state.scale ?? 1)}px`,
              aspectRatio: `${width} / ${height}`,
            }}
            onMouseDown={this.didMouseDown}
            on={{
              auxclick: (event) => {
                if (event.button === 1) event.preventDefault();
              },
            }}
            title="Drag the divider to compare. Middle-click to switch Old and New."
          >
            <div className="git-panel-ImagePatchView-newLayer" dataset={{ side: "new" }}>
              {this.renderComparisonImage("new", width, height)}
            </div>
            <div
              className="git-panel-ImagePatchView-oldLayer"
              dataset={{ side: "old" }}
              style={{ clipPath: `inset(0 ${100 - this.state.position}% 0 0)` }}
            >
              {this.renderComparisonImage("old", width, height)}
            </div>
            <div
              className="git-panel-ImagePatchView-divider"
              style={{ left: `${this.state.position}%` }}
              attributes={{
                role: "slider",
                tabindex: "0",
                "aria-label": "Old and new image boundary",
                "aria-orientation": "horizontal",
                "aria-valuemin": "0",
                "aria-valuemax": "100",
                "aria-valuenow": String(Math.round(this.state.position)),
                "aria-valuetext": `${Math.round(this.state.position)}% old, ${100 - Math.round(this.state.position)}% new`,
              }}
              on={{
                pointerdown: this.didPointerDown,
                pointermove: this.didPointerMove,
                pointerup: this.didPointerUp,
                pointercancel: this.didPointerUp,
                lostpointercapture: this.didPointerUp,
              }}
              onKeyDown={this.didKeyDown}
            />
          </div>
        </div>
      </div>
    );
  }

  render() {
    if (this.props.layout !== "side-by-side") {
      return (
        <div className="git-panel-ImagePatchView git-panel-ImagePatchView--unified">
          {sides.every((side) => this.state[side].status === "ready")
            ? this.renderComparison()
            : sides.map((side) =>
                this.state[side].status === "ready" ? (
                  this.renderSide(side)
                ) : (
                  <p className="git-panel-ImagePatchView-status" dataset={{ side }}>
                    {titles[side]}: {this.statusMessage(side)}
                  </p>
                ),
              )}
        </div>
      );
    }
    return (
      <div className="git-panel-ImagePatchView">{sides.map((side) => this.renderSide(side))}</div>
    );
  }

  statusMessage(side) {
    return {
      loading: "Loading image…",
      absent: "File absent in this version",
      unsupported: "This version is not a supported image",
      unavailable: "Image unavailable",
      error: "Unable to preview image",
    }[this.state[side].status];
  }

  release() {
    this.stopDragging();
    this.request?.abort();
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
  }

  willDestroy() {
    this.release();
    this.windowParticipant?.dispose();
    this.resizeObserver?.disconnect();
  }
}
