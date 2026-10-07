const { requirePatchView } = require("../../patch-view");
module.exports = {
  buildFilePatch: (...args) => requirePatchView().buildFilePatch(...args),
  buildMultiFilePatch: (...args) => requirePatchView().buildMultiFilePatch(...args),
};
