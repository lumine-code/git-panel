const { CompositeDisposable, Disposable } = require("lumine");

module.exports = {
  handlesItem: (item) => item?.kind === "git-patch",

  observeHeaders(item, callback) {
    const subscriptions = new CompositeDisposable();
    let disposed = false;
    const stop = () => {
      disposed = true;
      subscriptions.dispose();
    };
    subscriptions.add(item.onDidDestroy(stop));
    const observe = (view) => {
      if (!disposed && view) {
        subscriptions.add(
          view.observeNavigationHeaders((headers) => callback(headers, { instant: true })),
        );
      }
    };
    const view = item.getHydratedView();
    if (view) observe(view);
    else {
      callback([], { instant: true });
      item.whenHydrated().then(observe);
    }
    return new Disposable(stop);
  },

  navigateTo: (item, header, options) =>
    item.getHydratedView()?.navigateToNavigationHeader(header, options),
};
