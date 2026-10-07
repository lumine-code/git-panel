const patchViews = require("../lib/patch-view");
let edge;

beforeEach(async () => {
  require("../lib/index");
  const provider = await lumine.packages.startPackage("patch-view");
  if (!patchViews.getPatchView())
    edge = patchViews.consumePatchView(provider.mainModule.providePatchView());
});
afterEach(() => {
  edge?.dispose();
  edge = null;
});
