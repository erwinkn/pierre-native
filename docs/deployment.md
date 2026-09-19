# Cloudflare Pages

The manual preview runs as a Cloudflare Worker with static assets:
[pierre-native-preview.fluo-erwin.workers.dev](https://pierre-native-preview.fluo-erwin.workers.dev).
Wrangler's Pages command selected Workers for this preview. Its explicit
configuration is in `wrangler.jsonc`, with `dist/site` as the asset directory.
Run `bun run deploy` to rebuild and update this preview after verification.

The account's Pages Git installation currently rejects project creation.
Automatic deployment remains pending until that installation is reconnected.
The workflow also supports direct deployment to the preview through a scoped
Cloudflare API token, without the Git installation. Set the repository secret
`CLOUDFLARE_API_TOKEN`, the variable `CLOUDFLARE_ACCOUNT_ID`, and the variable
`CLOUDFLARE_DEPLOY_ENABLED` to `true`. The token needs permission to deploy the
account's Workers scripts and assets. Until configured, this job is skipped.

The GitHub workflow builds and tests the native app and the browser playground.
It publishes the verified static website to the generated `pages` branch.
Cloudflare Pages then deploys that branch through its GitHub integration.
The Rust build runs in GitHub Actions, so Cloudflare does not need Rust tooling.

Connect Cloudflare Pages to `erwinkn/pierre-native` with these settings:

| Setting                    | Value    |
| -------------------------- | -------- |
| Production branch          | `pages`  |
| Framework preset           | None     |
| Build command              | Empty    |
| Build output directory     | `.`      |
| Automatic preview branches | Disabled |

Do not edit the generated branch. Each verified build replaces its contents.
The source stays on `main`. Pull requests run the same verification but do not
publish the website branch. This workflow requires no Cloudflare credential
in the repository or in GitHub Actions.

Both the website and iframe need the isolation headers in `web/_headers`.
The build copies this file to the static output. A deployment check must confirm
`crossOriginIsolated` in the playground frame, the selected graphics backend,
editor input, and asset loading.

See Cloudflare's [GitHub integration documentation](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)
for installation and repository access. A failed GitHub installation must be
reconnected in Cloudflare before automatic deployments can run.
