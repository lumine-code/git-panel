const { Disposable, Emitter } = require("lumine");

const providers = new Set();
const emitter = new Emitter();

function getRepositorySetup() {
  return [...providers].at(-1)?.service ?? null;
}

function consumeRepositorySetup(service) {
  const previous = getRepositorySetup();
  const edge = { service };
  providers.add(edge);
  if (getRepositorySetup() !== previous) emitter.emit("did-change");
  return new Disposable(() => {
    const previous = getRepositorySetup();
    providers.delete(edge);
    if (getRepositorySetup() !== previous) emitter.emit("did-change");
  });
}

function onDidChangeRepositorySetup(callback) {
  return emitter.on("did-change", callback);
}

module.exports = { consumeRepositorySetup, getRepositorySetup, onDidChangeRepositorySetup };
