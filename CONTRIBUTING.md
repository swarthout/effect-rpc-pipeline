# Contributing

The [documentation website](https://github.com/swarthout/effect-rpc-pipeline/tree/main/website) has its own development, build, and browser-check commands. Its content reuses the README, guides, and generated API reference.

Use Node.js 24.11+ (24.x) or 26+, and npm. The root and the two examples have independent lockfiles. `repos/` contains read-only historical source references; do not import or edit those snapshots as part of library work.

From a clean checkout:

```sh
npm ci
npm run build
npm run examples:install
npm run check
npm run examples:check
npm run pack:check
```

Build before installing the examples. The blog copies the local package into its installation, so run `npm ci --prefix examples/blogapp` after changing or rebuilding the library before testing the blog. The todo example uses a symlink and deduplicates Effect for local testing. `pack:check` separately verifies a real tarball installation without either mechanism.

`check` runs the library typecheck, tests, build, documentation compilation, generated-reference check, and local documentation links. `examples:check` runs both example typechecks/tests and the blog's production build. Transport tests bind ephemeral loopback ports. `pack:check` installs the actual tarball in a temporary directory, verifies every runtime and type export, runs HTTP/WebSocket/stream smoke tests, compiles the README files, and bundles the browser entry. It needs npm registry access.

Add regressions for user-visible defects and meaningful negative type tests for inference or requirement changes. Confirm a new regression fails without its fix. Keep public behavior documented in [contracts and limits](docs/guides/contracts.md). Update generated references after changing APIs:

```sh
npm run build
npm run docs:generate
npm run docs:check
```

The blog follows Foldkit's Model, Message, update, Command, and view architecture. Its explicit npm overrides reconcile Foldkit 0.169.0's exact Effect 4.0.0 peers with the tested 4.0.6 ecosystem. Do not use `--force` or `--legacy-peer-deps` to hide dependency conflicts. Recheck those overrides when updating Foldkit.

For issues, include a minimal reproduction, package and Effect versions, Node/browser version, transport, expected behavior, and actual behavior. Follow [SECURITY.md](SECURITY.md) for vulnerabilities.
