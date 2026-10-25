# Contributing

Use Node.js 24.11+ in the 24.x line, or Node.js 26+, with npm.

The library, examples, and [documentation website](https://github.com/swarthout/effect-rpc-pipeline/tree/main/website) have separate dependency installations. `repos/` contains read-only historical references; do not import or edit those snapshots for library work.

## Set up and check the repository

From a clean checkout:

```sh
npm ci
npm run build
npm run examples:install
npm run check
npm run examples:check
npm run pack:check
```

Build the library before installing the examples.

| Command | Checks |
| --- | --- |
| `check` | Library types, tests, build, documentation snippets, generated reference, and local links |
| `examples:check` | Both example typechecks and tests, plus the blog production build |
| `pack:check` | Real tarball installation, runtime/type exports, HTTP/WebSocket/stream smoke tests, README compilation, and browser bundling |

Transport tests listen on ephemeral loopback ports. The package check needs npm registry access and installs into a temporary directory.

## After changing the library

The blog installs a copy of the local package. After rebuilding the library, run `npm ci --prefix examples/blogapp` to refresh that copy before testing it.

The todo example uses a symlink and deduplicates Effect for local tests. `pack:check` verifies a real package installation without either example's local setup.

Add regressions for user-visible defects and meaningful type checks for inference or service-requirement changes. Confirm that a new regression fails without its fix.

## Update documentation

Keep runtime behavior documented in [contracts and limits](docs/guides/contracts.md). After API changes, regenerate the reference and check the snippets:

```sh
npm run build
npm run docs:generate
npm run docs:check
```

The README is the main overview. Explain a task before its code, keep paragraphs focused, and give detailed constraints a labeled home in the guides. Preserve the checked snippet markers when editing examples.

The website reuses the Markdown sources. Its [README](https://github.com/swarthout/effect-rpc-pipeline/tree/main/website) explains how to build and check rendered pages.

## Work on the blog

The UI follows Foldkit's Model, Message, update, Command, and view architecture.

The example uses explicit npm overrides to reconcile Foldkit 0.169.0's exact Effect 4.0.0 peers with the tested 4.0.6 ecosystem. Recheck those overrides when updating Foldkit. Do not use `--force` or `--legacy-peer-deps` to hide conflicts.

## Report an issue

Include a minimal reproduction and these details:

- Package and Effect versions.
- Node or browser version and transport.
- Expected and actual behavior.

For vulnerabilities, follow [SECURITY.md](SECURITY.md).
