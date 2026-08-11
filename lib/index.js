/** @babel */
let packageOptions;
let pack;

function createPackageOptions() {
  return {
    workspace: lumine.workspace,
    project: lumine.project,
    repositories: lumine.repositories,
    commands: lumine.commands,
    notificationManager: lumine.notifications,
    tooltips: lumine.tooltips,
    styles: lumine.styles,
    keymaps: lumine.keymaps,
    grammars: lumine.grammars,
    config: lumine.config,
    deserializers: lumine.deserializers,

    confirm: lumine.window.confirm.bind(lumine.window),
    getInitialPaths: lumine.window.getInitialPaths.bind(lumine.window),

    configDirPath: lumine.getConfigDirPath(),
  };
}

function ensurePackage() {
  if (!pack) {
    const gitPackageModule = require("./git-package");
    const GitPackage = gitPackageModule.default || gitPackageModule;
    pack = new GitPackage(packageOptions || createPackageOptions());
  }
  return pack;
}

const entry = {
  initialize() {
    packageOptions = createPackageOptions();
  },

  // Declared here rather than left to the proxy below. These are the methods
  // `package.json` names — the package's wiring, which belongs in the module a
  // reader opens rather than behind a proxy trap that answers to any name.
  // Constructing the package is still deferred: `ensurePackage` runs when the
  // method is called, not now.
  provideGitPanel() {
    return ensurePackage().provideGitPanel();
  },

  consumeStatusBar(statusBar) {
    return ensurePackage().consumeStatusBar(statusBar);
  },

  consumeBusySignal(busySignal) {
    return ensurePackage().consumeBusySignal(busySignal);
  },

  // Goes to the holder module, not the package instance: the commit box may be
  // built before or after the linter connects, and neither side should force
  // the other to exist first.
  consumeLinterEditors(register) {
    return require("./linter-editors").consumeLinterEditors(register);
  },
};

module.exports = new Proxy(entry, {
  get(target, name) {
    if (Reflect.has(target, name)) {
      return target[name];
    }

    const packageInstance = ensurePackage();
    if (Reflect.has(packageInstance, name)) {
      let item = packageInstance[name];
      if (typeof item === "function") {
        item = item.bind(packageInstance);
      }
      return item;
    } else {
      return target[name];
    }
  },
});
