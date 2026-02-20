/** @babel */
/**
 * Uniformly trigger a refetch of all GraphQL query containers within a scoped hierarchy.
 */
export default class Refresher {
  constructor() {
    this.dispose();
  }

  setRetryCallback(key, retryCallback) {
    this.retryByKey.set(key, retryCallback);
  }

  trigger() {
    for (const [, retryCallback] of this.retryByKey) {
      if (typeof retryCallback === "function") {
        retryCallback();
      }
    }
  }

  deregister(key) {
    this.retryByKey.delete(key);
  }

  dispose() {
    this.retryByKey = new Map();
  }
}
