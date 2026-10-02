/** @babel */
import { Emitter } from "lumine";

// A holder makes late native DOM/model ownership explicit. Consumers subscribe
// once and dispose that subscription with the resource using the reference.
export default class RefHolder {
  constructor() {
    this.emitter = new Emitter();
    this.value = undefined;
  }

  isEmpty() {
    return this.value === undefined || this.value === null;
  }

  get() {
    if (this.isEmpty()) {
      throw new Error("RefHolder is empty");
    }
    return this.value;
  }

  getOr(def) {
    if (this.isEmpty()) {
      return def;
    }
    return this.value;
  }

  getPromise() {
    if (this.isEmpty()) {
      return new Promise((resolve) => {
        const sub = this.observe((value) => {
          resolve(value);
          sub.dispose();
        });
      });
    }

    return Promise.resolve(this.get());
  }

  map(present, absent = () => this) {
    return RefHolder.on(this.isEmpty() ? absent() : present(this.get()));
  }

  setter = (value) => {
    const oldValue = this.value;
    this.value = value;
    if (value !== oldValue && value !== null && value !== undefined) {
      this.emitter.emit("did-update", value);
    }
  };

  observe(callback) {
    if (!this.isEmpty()) {
      callback(this.value);
    }
    return this.emitter.on("did-update", callback);
  }

  static on(valueOrHolder) {
    if (valueOrHolder instanceof this) {
      return valueOrHolder;
    } else {
      const holder = new this();
      holder.setter(valueOrHolder);
      return holder;
    }
  }
}
