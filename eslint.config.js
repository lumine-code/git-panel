const js = require("@eslint/js");
const n = require("eslint-plugin-n");
const globals = require("globals");
const prettier = require("eslint-config-prettier");
// Local JSX rules keep each file's factory explicit and count JSX references
// for no-unused-vars without depending on a particular UI library.
const jsxPragmas = new WeakMap();
function readJSXPragmas(sourceCode) {
  if (!jsxPragmas.has(sourceCode)) {
    const pragmas = {};
    for (const comment of sourceCode.getAllComments()) {
      // Match Babel's annotation syntax and let the last annotation win.
      const factory = /^\s*(?:\*\s*)?@jsx\s+(\S+)\s*$/m.exec(comment.value);
      const fragment = /^\s*(?:\*\s*)?@jsxFrag\s+(\S+)\s*$/m.exec(comment.value);
      if (factory) pragmas.factory = factory[1];
      if (fragment) pragmas.fragment = fragment[1];
    }
    jsxPragmas.set(sourceCode, pragmas);
  }
  return jsxPragmas.get(sourceCode);
}

const jsx = {
  rules: {
    "require-pragma": {
      meta: {
        type: "problem",
        schema: [],
        messages: { missing: "This file contains JSX but declares no `/** @jsx ... */` pragma." },
      },
      create({ sourceCode, report }) {
        const { factory } = readJSXPragmas(sourceCode);
        let reported = false;
        function check(node) {
          if (factory || reported) return;
          reported = true;
          report({ node, messageId: "missing" });
        }
        return { JSXOpeningElement: check, JSXOpeningFragment: check };
      },
    },
    "jsx-uses": {
      meta: { type: "problem", schema: [] },
      create({ sourceCode }) {
        const { factory, fragment } = readJSXPragmas(sourceCode);
        function mark(expression, node) {
          if (expression) sourceCode.markVariableAsUsed(expression.split(".")[0], node);
        }
        return {
          JSXOpeningElement(node) {
            mark(factory, node);
            // Plain lowercase tags are strings; a member tag still references
            // its root even when that root starts with a lowercase letter.
            if (node.name.type === "JSXIdentifier" && /^[a-z]/.test(node.name.name)) return;
            let root = node.name;
            while (root.type === "JSXMemberExpression") root = root.object;
            if (root.type === "JSXIdentifier") sourceCode.markVariableAsUsed(root.name, root);
          },
          JSXOpeningFragment(node) {
            mark(factory, node);
            // A fragment type is separate from the factory that receives it.
            // Compiler defaults are outside this rule's explicit-pragma scope.
            mark(fragment, node);
          },
        };
      },
    },
  },
};

// `lumine` is provided by the Lumine runtime, not resolvable from this manifest.
const runtimeModules = ["lumine"];

module.exports = [
  {
    // The local dev sandbox is not linted.
    ignores: ["node_modules/**", ".dev/**"],
  },
  js.configs.recommended,
  {
    // The editor transpiles this package's `/** @babel */` sources, so lint the
    // ESM + JSX it actually contains rather than the CommonJS it compiles to.
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node,
        lumine: "readonly",
      },
    },
    plugins: { n, jsx },
    settings: {
      n: {
        version: ">=24.0.0",
        // For ESM sources eslint-plugin-n resolves without `mainFiles`, so a
        // directory import like `./models/patch` reads as missing. The editor's
        // babel preset compiles these modules to CommonJS, where they resolve
        // through the directory's index — restore those semantics.
        resolverConfig: { mainFiles: ["index"], mainFields: ["main"] },
      },
    },
    rules: {
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Arguments are not checked: view callbacks and the many overridden
      // methods in this port declare positional parameters they do not all use,
      // and renaming them would only obscure each signature.
      "no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" }],
      // JSX sources declare their factory in a `/** @jsx h */`
      // pragma; `require-pragma` keeps it that way, and `jsx-uses` reads the
      // factory from it, keeping JSX references visible to the linter.
      "jsx/require-pragma": "error",
      "jsx/jsx-uses": "error",
      // Only the resolution rules from eslint-plugin-n: they catch imports of
      // packages that were never declared as dependencies. The rest of the
      // preset assumes plain CommonJS and would just flag the ESM syntax.
      "n/no-missing-import": ["error", { allowModules: runtimeModules }],
      "n/no-extraneous-import": ["error", { allowModules: runtimeModules }],
    },
  },
  {
    // This configuration is dev tooling, loaded by ESLint as CommonJS.
    files: ["eslint.config.js", "prettier.config.js"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "n/no-extraneous-import": "off" },
  },
  {
    // Specs run in the Lumine jasmine runner and import devDependencies.
    files: ["spec/**", "**/*-spec.js"],
    languageOptions: { globals: { ...globals.jasmine } },
    rules: {
      "n/no-missing-import": "off",
      "n/no-extraneous-import": "off",
    },
  },
  // Must be last: turns off lint rules that would conflict with Prettier.
  prettier,
];
