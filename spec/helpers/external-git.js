const { execFile } = require("child_process");

// Observation fixtures must change repositories outside the registry so a
// successful assertion proves filesystem discovery rather than write refresh.
module.exports = function externalGit(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr, exitCode: 0 });
    });
  });
};
