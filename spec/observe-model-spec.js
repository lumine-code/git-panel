/** @babel */

import ReactDOM from "react-dom";

import ObserveModel from "../lib/views/observe-model";

describe("ObserveModel", () => {
  it("can publish asynchronous model data synchronously", () => {
    const data = { value: 42 };
    const order = [];
    const prepareData = jasmine.createSpy().and.callFake(() => order.push("prepare"));
    const view = new ObserveModel({ prepareData, synchronousUpdates: true });
    view.mounted = true;
    spyOn(view.modelObserver, "getActiveModelData").and.returnValue(data);
    spyOn(view, "setState").and.callFake(() => order.push("publish"));
    spyOn(ReactDOM, "flushSync").and.callFake((publish) => {
      order.push("flush");
      publish();
    });

    view.didUpdate();

    expect(prepareData).toHaveBeenCalledOnceWith(data);
    expect(ReactDOM.flushSync).toHaveBeenCalledTimes(1);
    expect(view.setState).toHaveBeenCalledOnceWith({ data });
    expect(order).toEqual(["flush", "prepare", "publish"]);
  });

  it("does not prepare or flush the initial empty model state", () => {
    const prepareData = jasmine.createSpy();
    const view = new ObserveModel({ prepareData, synchronousUpdates: true });
    view.mounted = true;
    spyOn(view.modelObserver, "getActiveModelData").and.returnValue(null);
    spyOn(view, "setState");
    spyOn(ReactDOM, "flushSync");

    view.didUpdate();

    expect(prepareData).not.toHaveBeenCalled();
    expect(ReactDOM.flushSync).not.toHaveBeenCalled();
    expect(view.setState).toHaveBeenCalledOnceWith({ data: null });
  });
});
