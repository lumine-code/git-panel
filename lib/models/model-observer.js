/** @babel */
export default class ModelObserver {
  constructor({ fetchData, didUpdate }) {
    this.fetchData = fetchData || (() => {});
    this.didUpdate = didUpdate || (() => {});
    this.activeModel = null;
    this.activeModelData = null;
    this.activeModelUpdateSubscription = null;
    this.activeRefresh = null;
    this.destroyed = false;
    this.inProgress = false;
    this.pending = false;
  }

  setActiveModel(model) {
    if (this.destroyed) {
      return null;
    }
    if (model !== this.activeModel) {
      if (this.activeModelUpdateSubscription) {
        this.activeModelUpdateSubscription.dispose();
        this.activeModelUpdateSubscription = null;
      }
      this.activeModel = model;
      this.activeModelData = null;
      this.activeRefresh = null;
      this.inProgress = false;
      this.pending = false;
      this.didUpdate(model);
      if (model && (!model.isDestroyed || !model.isDestroyed())) {
        this.activeModelUpdateSubscription = model.onDidUpdate(() => this.refreshModelData(model));
        return this.refreshModelData(model);
      }
    }
    return null;
  }

  refreshModelData(model = this.activeModel) {
    if (
      this.destroyed ||
      !model ||
      model !== this.activeModel ||
      (model.isDestroyed && model.isDestroyed())
    ) {
      return null;
    }
    if (this.inProgress) {
      this.pending = true;
      return null;
    }
    this.lastModelDataRefreshPromise = this._refreshModelData(model);
    return this.lastModelDataRefreshPromise;
  }

  async _refreshModelData(model) {
    const request = {};
    this.activeRefresh = request;
    try {
      this.inProgress = true;
      const fetchDataPromise = this.fetchData(model);
      this.lastFetchDataPromise = fetchDataPromise;
      const modelData = await fetchDataPromise;
      // Since we re-fetch immediately when the model changes,
      // we need to ensure a fetch for an old active model
      // does not trample the newer fetch for the newer active model. Likewise,
      // when this model changed during the fetch, do not publish a result that
      // is already superseded for one render before the pending refresh runs.
      if (
        this.activeRefresh === request &&
        model === this.activeModel &&
        (!model.isDestroyed || !model.isDestroyed()) &&
        !this.pending
      ) {
        this.activeModelData = modelData;
        this.didUpdate(model);
      }
    } catch (error) {
      if (this.activeRefresh !== request || model !== this.activeModel) {
        return;
      }
      // A move or removal can invalidate an in-flight read before the registry
      // switches contexts. Clear obsolete data while consuming that expected
      // background failure; keep unexpected failures visible for diagnostics.
      if (
        error.code === "ERR_GIT_REPOSITORY_UNAVAILABLE" ||
        error.code === "ERR_GIT_REPOSITORY_DESTROYED" ||
        error.code === "ABORT_ERR" ||
        error.name === "AbortError" ||
        (model.isDestroyed && model.isDestroyed())
      ) {
        this.activeModelData = null;
        this.didUpdate(model);
      } else {
        console.error("Git panel model data refresh failed", error);
      }
    } finally {
      // A previous context's completion must not end the replacement context's
      // refresh or consume the update it queued while its own read was running.
      if (this.activeRefresh === request && model === this.activeModel) {
        this.activeRefresh = null;
        this.inProgress = false;
        if (this.pending) {
          this.pending = false;
          this.refreshModelData();
        }
      }
    }
  }

  getActiveModel() {
    return this.activeModel;
  }

  getActiveModelData() {
    return this.activeModelData;
  }

  getLastModelDataRefreshPromise() {
    return this.lastModelDataRefreshPromise;
  }

  hasPendingUpdate() {
    return this.pending;
  }

  destroy() {
    this.destroyed = true;
    this.activeRefresh = null;
    this.inProgress = false;
    this.pending = false;
    if (this.activeModelUpdateSubscription) {
      this.activeModelUpdateSubscription.dispose();
      this.activeModelUpdateSubscription = null;
    }
  }
}
