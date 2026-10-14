/** @babel */
/** @jsx h */
import { View, h } from "../etch/view.js";
import { imageMimeType, imageEndpoints } from "../image-patch.js";

const sides = ["old", "new"];
const titles = { old: "Old", new: "New" };

// Each mounted preview owns its reads and Blob URLs. A refreshed patch always
// reads again, including image changes whose empty text diff stays identical.
export default class ImagePatchView extends View {
  constructor(props) {
    super(props);
    this.urls = new Set();
    this.state = this.initialState();
    this.initialize();
  }

  initialState() {
    return Object.fromEntries(
      sides.map((side) => {
        const file = this.file(side);
        return [
          side,
          {
            status: !file.isPresent() ? "absent" : imageMimeType(file) ? "loading" : "unsupported",
          },
        ];
      }),
    );
  }

  file(side) {
    return side === "old" ? this.props.filePatch.getOldFile() : this.props.filePatch.getNewFile();
  }

  didMount() {
    this.load();
  }

  update(props) {
    if (this.destroyed) return Promise.resolve();
    const changed =
      props.filePatch !== this.props.filePatch ||
      props.repository !== this.props.repository ||
      props.document !== this.props.document ||
      props.commit !== this.props.commit;
    if (changed) {
      this.rememberPrevious();
      this.release();
      this.props = this.resolveProps(props);
      this.state = this.initialState();
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
          const url = URL.createObjectURL(new Blob([contents], { type: imageMimeType(file) }));
          this.urls.add(url);
          await this.updateState({ [side]: { status: "ready", url } });
        } catch {
          if (!this.destroyed && !request.signal.aborted && this.request === request)
            await this.updateState({ [side]: { status: "error" } });
        }
      }),
    );
  }

  didLoadImage(side, url, event) {
    if (this.destroyed || this.state[side].url !== url) return;
    const image = event.target;
    this.updateState({
      [side]: { ...this.state[side], width: image.naturalWidth, height: image.naturalHeight },
    });
  }

  didFailImage(side, url) {
    if (this.destroyed || this.state[side].url !== url) return;
    URL.revokeObjectURL(url);
    this.urls.delete(url);
    this.updateState({ [side]: { status: "error" } });
  }

  renderSide(side) {
    const state = this.state[side];
    const source = imageEndpoints(this.props.document, this.props.commit)[side];
    const messages = {
      loading: "Loading image…",
      absent: "File absent in this version",
      unsupported: "This version is not a supported image",
      unavailable: "Image unavailable",
      error: "Unable to preview image",
    };
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
        <div className="git-panel-ImagePatchView-preview" attributes={{ "aria-live": "polite" }}>
          {state.status === "ready" ? (
            <img
              key={state.url}
              src={state.url}
              alt={`${titles[side]}: ${this.file(side).getPath()}`}
              draggable={false}
              onLoad={(event) => this.didLoadImage(side, state.url, event)}
              onError={() => this.didFailImage(side, state.url)}
            />
          ) : (
            <p>{messages[state.status]}</p>
          )}
        </div>
      </figure>
    );
  }

  render() {
    return (
      <div className="git-panel-ImagePatchView">{sides.map((side) => this.renderSide(side))}</div>
    );
  }

  release() {
    this.request?.abort();
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
  }

  willDestroy() {
    this.release();
  }
}
