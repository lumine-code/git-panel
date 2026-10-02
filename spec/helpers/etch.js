/** @babel */
import etch from "@lumine-code/etch";
import View, { h, mount } from "../../lib/etch/view";

export { h, View };

// Controller method tests use partial data fixtures. Mounted view and lifecycle
// suites exercise the real constructor, scheduler and DOM separately.
export function createViewModel(ViewType, props) {
  class ModelFixture extends ViewType {
    initialize() {
      return this;
    }
  }
  return new ModelFixture(props);
}

export function childrenOf(node) {
  return Array.isArray(node) ? node : node.children;
}

export function cloneVNode(node, props) {
  return h(node.tag, { ...node.props, ...props }, ...node.children);
}

export function createViewHost(container) {
  etch.setScheduler(lumine.views);
  return mount(null, container);
}

export async function flushViews(callback) {
  await callback();
  await globalThis.flushMicrotasks();
  lumine.views.updateDocument(() => {});
  await lumine.views.getNextUpdatePromise();
  await globalThis.flushMicrotasks();
}
