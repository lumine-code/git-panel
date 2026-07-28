/** @babel */
let packageOptions;
let pack;

function createPackageOptions() {
  return {
    workspace: atom.workspace,
    project: atom.project,
    repositories: atom.repositories,
    commands: atom.commands,
    notificationManager: atom.notifications,
    tooltips: atom.tooltips,
    styles: atom.styles,
    keymaps: atom.keymaps,
    grammars: atom.grammars,
    config: atom.config,
    deserializers: atom.deserializers,

    confirm: atom.confirm.bind(atom),
    getLoadSettings: atom.getLoadSettings.bind(atom),
    currentWindow: atom.getCurrentWindow(),

    configDirPath: atom.getConfigDirPath(),
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
