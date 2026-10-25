# Documentation website

The website is a Foldkit application on Effect 4. The build renders every page to HTML; the browser hydrates those pages for navigation, search, and the graph demo. GitHub Pages serves the static files.

## Run locally

Use the same Node version as the library. From the repository root:

```sh
npm ci
npm run build
npm ci --prefix website
npm run dev --prefix website
```

Open `http://127.0.0.1:4173/effect-rpc-pipeline/`.

The dev server uses Foldkit's server entry to render routes. After editing shared Markdown, restart the server to regenerate its content.

## Edit the content

| Content | Edit here |
| --- | --- |
| Overview and quickstart | Root `README.md` |
| Detailed integrations and contracts | `docs/guides/` |
| API introductions | `scripts/generate-api.mjs` at the repository root |
| API signatures and comments | Library source, then regenerate the reference |
| Website page selection | `website/scripts/content.ts` |

The README remains a standalone introduction. The content script selects its sections and the guides into focused website pages.

After API changes, run these commands from the repository root:

```sh
npm run build
npm run docs:generate
```

`docs/api/` is generated output; edits there will be overwritten.

## Check the site

From the repository root:

```sh
npm run check --prefix website
cd website
npx playwright install chromium
npm run test:browser
```

| Check | Verifies |
| --- | --- |
| `check` | Content compilation, types, state/search tests, static build, links, anchors, assets, metadata, and sitemap |
| `test:browser` | Hydration, clicked navigation, focus, clipboard, search, themes, mobile layout, and reading without JavaScript |

Browser tests start and stop their own preview server. Port 4173 must be free.

To inspect production output separately, run `npm run preview --prefix website` from the repository root after building.

## Build and runtime

`@foldkit/markdown` parses and validates prose. Shiki highlights code during the build. The browser receives compiled documents and a local search index. Fonts are self-hosted; there are no analytics or third-party runtime requests.

The graph demo is an illustrative simulation. Its state and effects follow Foldkit's Model, Message, and Command architecture.

Generated content, static output, and browser artifacts are ignored by Git. The website is excluded from the npm package and has its own dependencies. Its overrides align Foldkit's exact Effect 4.0.0 peer declarations with the tested 4.0.6 baseline.

The implementation follows [Foldkit's](https://foldkit.dev/) static generation and Markdown patterns. `repos/foldkit` is a read-only reference, not a runtime dependency.

## Deploy to GitHub Pages

The `Documentation website` workflow validates pull requests. Successful builds on `main` deploy to `https://swarthout.github.io/effect-rpc-pipeline/`.

In Settings → Pages, select **GitHub Actions** as the build source.

Each route has its own `index.html`, so deep links work without SPA rewrites. `404.html` renders a missing-page view, and `.nojekyll` preserves build assets. Foldkit handles subsequent browser navigation.

### Use a different domain or path

Set these variables for the entire build:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SITE_BASE` | `/effect-rpc-pipeline/` | URL path prefix; must start and end with `/` |
| `SITE_ORIGIN` | `https://swarthout.github.io` | Origin used in canonical URLs and the sitemap |

For a custom domain or root-hosted preview, use `SITE_BASE=/`. Set `SITE_ORIGIN` to the new origin, configure the domain in GitHub Pages, and add its `CNAME` file to `website/public/`.
