const { Disposable } = require("lumine");
const providers = new Set();

function consumeCommitLinks(provider) {
  providers.add(provider);
  return new Disposable(() => providers.delete(provider));
}
function getCommitURL(remote, sha) {
  for (const provider of providers) {
    const url = provider.buildCommitURL(remote, sha);
    if (url) return url;
  }
  return null;
}
module.exports = { consumeCommitLinks, getCommitURL };
