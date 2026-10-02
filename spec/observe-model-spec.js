/** @babel */
import { h, flushViews } from "./helpers/etch";
import ObserveModel from "../lib/views/observe-model";

describe("ObserveModel publication", () => {
  let view;
  afterEach(() => view?.destroy());

  it("publishes the prepared model and matching DOM in one synchronous update", () => {
    const order = [];
    const data = { value: 42 };
    const prepareData = jasmine.createSpy().and.callFake(() => order.push("prepare"));
    view = new ObserveModel({
      model: null,
      fetchData: () => null,
      prepareData,
      synchronousUpdates: true,
      children: (snapshot) => {
        if (snapshot) order.push("render");
        return h("span", {}, snapshot ? snapshot.value : "empty");
      },
    });
    spyOn(view.modelObserver, "getActiveModelData").and.returnValue(data);
    view.publishModelData();
    expect(prepareData).toHaveBeenCalledOnceWith(data);
    expect(view.element.textContent).toBe("42");
    expect(order).toEqual(["prepare", "render"]);
  });

  it("does not prepare the initial empty model state", async () => {
    const prepareData = jasmine.createSpy();
    view = new ObserveModel({
      model: null,
      fetchData: () => null,
      prepareData,
      synchronousUpdates: true,
      children: (snapshot) => h("span", {}, snapshot === null ? "empty" : "populated"),
    });
    spyOn(view.modelObserver, "getActiveModelData").and.returnValue(null);
    await flushViews(() => view.publishModelData());
    expect(prepareData).not.toHaveBeenCalled();
    expect(view.element.textContent).toBe("empty");
  });

  it("ignores model publication after destruction", () => {
    const prepareData = jasmine.createSpy();
    view = new ObserveModel({
      model: null,
      fetchData: () => null,
      prepareData,
      synchronousUpdates: true,
      children: () => h("span", {}, "initial"),
    });
    spyOn(view.modelObserver, "getActiveModelData").and.returnValue({ value: 42 });
    view.destroy();
    view.publishModelData();
    expect(prepareData).not.toHaveBeenCalled();
  });
});
