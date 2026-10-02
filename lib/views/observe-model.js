/** @babel */
import { View, h, transaction } from "../etch/view";

import ModelObserver from "../models/model-observer";

export default class ObserveModel extends View {
  static defaultProps = {
    fetchParams: [],
  };

  constructor(props, children) {
    super(props, children);

    this.state = { data: null };
    this.modelObserver = new ModelObserver({
      fetchData: this.fetchData,
      didUpdate: this.publishModelData,
    });

    this.initialize();
  }

  didMount() {
    this.mounted = true;
    this.modelObserver.setActiveModel(this.props.model);
  }

  didUpdate(prevProps) {
    this.modelObserver.setActiveModel(this.props.model);

    if (
      (!this.modelObserver.hasPendingUpdate() &&
        prevProps.fetchParams.length !== this.props.fetchParams.length) ||
      prevProps.fetchParams.some((prevParam, i) => prevParam !== this.props.fetchParams[i])
    ) {
      this.modelObserver.refreshModelData();
    }
  }

  fetchData = (model) => this.props.fetchData(model, ...this.props.fetchParams);

  publishModelData = () => {
    if (this.mounted) {
      const data = this.modelObserver.getActiveModelData();
      const publish = () => {
        if (data !== null && this.props.prepareData) {
          this.props.prepareData(data);
        }
        this.updateState({ data });
      };
      // Buffer adoption and its matching view generation must finish before another paint.
      if (this.props.synchronousUpdates && data !== null) {
        transaction(publish);
      } else {
        publish();
      }
    }
  };

  render() {
    return h("span", { style: { display: "contents" } }, this.props.children(this.state.data));
  }

  willDestroy() {
    this.mounted = false;
    this.modelObserver.destroy();
  }
}
