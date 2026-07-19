const path = require("path");

function getRepositoryName(source) {
  let pathname;

  if (/^[A-Za-z]:[\\/]/.test(source)) {
    pathname = source;
  } else {
    try {
      pathname = new URL(source).pathname;
    } catch (error) {
      if (!(error instanceof TypeError)) {
        throw error;
      }

      const scpMatch = /^(?:[^@/\\:\s]+@)?[^/\\:\s]+:(.+)$/.exec(source);
      pathname = scpMatch ? scpMatch[1] : source;
      pathname = pathname.split(/[?#]/, 1)[0];
    }
  }

  const portablePathname = pathname.replace(/\\/g, "/");
  return path.posix.basename(portablePathname, ".git") || "";
}

module.exports = { getRepositoryName };
