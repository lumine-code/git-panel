const js = require("@eslint/js");
const n = require("eslint-plugin-n");
const globals = require("globals");
const prettier = require("eslint-config-prettier");
const jsx = require("./eslint-jsx");

// `atom` is provided by the Lumine runtime, not resolvable from this manifest.
const runtimeModules = ["atom"];

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
        atom: "readonly",
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
      // Arguments are not checked: React callbacks and the many overridden
      // methods in this port declare positional parameters they do not all use,
      // and renaming them would only obscure each signature.
      "no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "jsx/jsx-uses": "error",
      // Only the resolution rules from eslint-plugin-n: they catch imports of
      // packages that were never declared as dependencies. The rest of the
      // preset assumes plain CommonJS and would just flag the ESM syntax.
      "n/no-missing-import": ["error", { allowModules: runtimeModules }],
      "n/no-extraneous-import": ["error", { allowModules: runtimeModules }],
    },
  },
  {
    // This config and its helper are dev tooling, loaded by eslint as CommonJS.
    files: ["eslint.config.js", "eslint-jsx.js", "prettier.config.js"],
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
