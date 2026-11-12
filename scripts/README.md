# Published House source updater

Official `clunkyard/house-<slug>` template repositories share `sync-house.cjs`.
Their staggered 15-minute workflows download a reviewed immutable commit and verify the
script's SHA-256 before running it. There are no organization secrets or broad
tokens; each workflow writes only its repository with its own `GITHUB_TOKEN`.

The exact official repository is required by both the workflow and script.
Player copies never auto-update their robot. The updater reads only public
published profiles and v2 source exports, checks sizes, SHA-256 hashes, modes,
safe paths and stable source identity, then updates verified managed files.
It refuses private/internal paths, dirty checkouts and edited source. It never
runs downloaded robot programs, changes its workflow or force-pushes.

`.clunkyard-source.json` binds each template to the public House bot's frozen
revision and original manifest hash. Its visible export hash is checked
separately because the public exporter removes Git/platform metadata.
`bot.json.language` is normalized to the local CLI's canonical slug; robot
program bytes remain unchanged.

Maintainers can prepare candidates with `--out NEW_DIRECTORY` and publish
absent public templates with `--apply --updater-ref REVIEWED_COMMIT_SHA`.
The prepared `templates.json` and generated workflows must be reviewed first.
Existing remote repositories are refused. A normal template update runs:

```sh
node sync-house.cjs --sync PUBLISHED_BOT_UUID --slug EXACT_SLUG
```

This command requires `GITHUB_REPOSITORY=clunkyard/house-EXACT_SLUG`, a clean
Git checkout and intact prior managed-file metadata. The scheduled workflow sets
the repository identity through GitHub Actions. It has no application or
private-workspace access.

Run the safety suite with Node 20+:

```sh
node --test test/sync-house.test.cjs
```

Review and test updates here, then pin a new signed commit and matching script
SHA-256 in official templates. Existing pins do not update automatically. Generated guides and tooling refresh even when the public robot revision is unchanged; an already current tree remains untouched.

After changing a schedule, verify a real `schedule` event succeeds. Manual dispatch proves the updater, not scheduler delivery. If an enabled schedule stops delivering while manual dispatch works, GitHub recommends committing a cron change; see [workflow troubleshooting](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows#scheduled-workflow-stopped-running).

Questions belong in [game-kit Discussions](https://github.com/clunkyard/game-kit/discussions).
Report security problems through [private intake](../SECURITY.md).
