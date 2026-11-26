# Documentation-set state and destinations

Documenter 2 stores one stable identity for each documentation set. The identity survives a destination move and records the active generation, selected style, source policy, and front-page policy.

## State layout

State is repository-local:

| Path | Purpose |
| --- | --- |
| `.documenter/config.json` | Global defaults, limits, adapter policy, parallel policy, and Git policy. |
| `.documenter/sets.json` | Set registry and active-generation pointers. |
| `.documenter/sets/SET_ID/config.json` | Destination, front-page paths, source policy, and style selection. |
| `.documenter/sets/SET_ID/generations/GENERATION_ID/` | Immutable generation manifests, evidence, ownership, topics, and validation receipts. |
| `.documenter/styles/STYLE_HASH.json` | Immutable style profile and provenance. |
| `.documenter/runs/RUN_ID/` | Run manifest, plans, events, staged files, and validation receipts. |
| `.documenter/archives/ARCHIVE_ID/` | Verified historical content and state. |
| `.documenter/migrations/MIGRATION_ID/` | Prepared migration and rollback manifest. |
| `.documenter/write.lock` | Cooperating writer identity and active operation. |

Archives, runs, work areas, diagnostics, and active state are not source evidence. The installed `.overhaul/documenter-v2` pack and its helper skills are tooling. Do not exclude all `.omp` content when only part of it is tooling.

## Destination rules

A core destination is a normalized, repository-relative directory. `docs` is the documented example. Absolute paths, `..` traversal, symlink components, hardlinked outputs, and special files are rejected. External output is not a core capability.

A set keeps its `setId` when its destination changes. A destination change is an explicit migration. It must preserve old-to-new path mappings and must not silently replace another active set's paths. Sets cannot overlap publication paths without an implemented sharing model.

The destination selects where the main documentation library is published. It does not change the source repository, style reference, or archive source. A style reference never becomes a destination.

## Front pages

`frontpagePolicy` controls recognised entry pages:

| Policy | Meaning |
| --- | --- |
| `none` | Publish no recognised front-page entries. |
| `root` | Select the recognised root entry page. |
| `all` | Select every recognised root and component entry page in the exact manifest. |

`frontpages` stores exact repository-relative paths. It is an inventory, not a wildcard. Keep each path and role in the immutable plan so navigation changes remain reviewable.

On a new set, omitting `--frontpage` records `none`. On an existing set, omitting it reuses the recorded policy. Use an explicit policy to change it. A front-page choice does not grant permission to overwrite a human-edited page.

The v2 writing command contract uses these options:

```text
/documenter overhaul --dest "Project Documentation" --frontpage all
/documenter maintain --set default
```

The command contract is separate from this repository's v1 runtime. Do not report a proposed command as implemented until the installed product and host have been checked.

## Generate the combined guide

Canonical source order is `README.md`, `docs/USER-GUIDE.md`, `docs/ARCHITECTURE.md`, `docs/ENGINE.md`, `docs/VALIDATION.md`, and `docs/ROADMAP.md`. Generate one derived file with:

```bash
node scripts/generate-guide.mjs --root . --output docs/DOCUMENTATION-GUIDE.md
```

The generator validates every source before writing. It preserves source order, rewrites repository-local links relative to the output, and creates no network requests. A missing source or an output path that is also a source fails without replacing the output. Use repeated `--source PATH` arguments to provide a different canonical order.
