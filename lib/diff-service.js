const path = require("path");
const { filterPatch } = require("lumine");

// Public rendering methods stay lazy so publishing the service does not build
// the Git panel or load its patch models and native view graph.
const service = {
  filterDiff: filterPatch,
  parseDiff: (rawPatch) => require("./parse-diff").parseDiff(rawPatch),
  buildFilePatch: (...args) => require("./models/patch").buildFilePatch(...args),
  buildMultiFilePatch: (...args) => require("./models/patch").buildMultiFilePatch(...args),
  buildPatch(snapshot, options = {}) {
    if (snapshot.files) {
      return service.buildMultiFilePatch(
        snapshot.files.map((file) => ({
          ...file,
          status: file.status === "typechange" ? "modified" : file.status,
          oldPath: file.oldPath == null ? null : path.normalize(file.oldPath),
          newPath: file.newPath == null ? null : path.normalize(file.newPath),
        })),
        options,
      );
    }
    const { filtered, removed } = filterPatch(snapshot.rawPatch || "");
    return service.buildMultiFilePatch(
      service.parseDiff(filtered).map((file) => ({
        ...file,
        oldPath: file.oldPath == null ? null : path.normalize(file.oldPath),
        newPath: file.newPath == null ? null : path.normalize(file.newPath),
      })),
      { ...options, preserveOriginal: true, removed },
    );
  },
  get ChangesView() {
    const component = require("./views/changes-view");
    return component.default || component;
  },
};

module.exports = service;
