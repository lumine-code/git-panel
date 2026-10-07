/** @babel */

// Progress comes from core for every Git entry point.
export default class OperationStates {
  constructor({ getOperations = () => null } = {}) {
    this.getOperations = getOperations;
  }
  isPending(name) {
    return Boolean(
      this.getOperations()
        ?.getPendingOperations()
        .some((operation) => operation.name.replace(/^workflow:/, "") === name),
    );
  }
  isPushInProgress() {
    return this.isPending("push");
  }
  isPullInProgress() {
    return this.isPending("pull");
  }
  isFetchInProgress() {
    return this.isPending("fetch");
  }
  isCommitInProgress() {
    return this.isPending("commit");
  }
  isCheckoutInProgress() {
    return this.isPending("checkout");
  }
}

export const nullOperationStates = new OperationStates();
