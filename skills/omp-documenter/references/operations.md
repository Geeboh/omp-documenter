# Helper operations and recovery

## Contents

1. Interfaces
2. State and configuration
3. Record and publish inputs
4. Execution and Git boundaries
5. Failures and recovery

## 1. Interfaces

Prefer the OMP `documenter_state` tool when the plugin is loaded. Its actions are:

| Action | Purpose |
| --- | --- |
| `scan` | Discover the current repository scope and record its inventory and changes |
| `status` | Inspect current coverage, freshness, exclusions, and remaining work |
| `record` | Record inspected files, claims, symbols, and unknowns |
| `publish` | Write a new Markdown page or safely replace an unchanged owned page |
| `check` | Check mechanical integrity and freshness; optionally require strict completeness |

Pass operation-specific JSON serialized as the `inputJson` string. The optional `root` is a session-relative child directory; omit it to use the session's current directory. Use the optional `strict` boolean for strict checking. Treat the result as authoritative for whether the operation succeeded. Read any returned warnings, gaps, conflicts, and proposal paths.

`scan`, `record`, and `publish` write state. `status` and `check` inspect live content without persisting a refreshed inventory. Run `scan` after publishing when you need the new documentation-page hashes in `.documenter/inventory.json`.

The equivalent CLI has this shape:

```bash
node /absolute/path/to/omp-documenter/scripts/documenter.mjs ACTION --root /absolute/path/to/repository
```

For `record` and `publish`, supply a UTF-8 JSON input file:

```bash
node /absolute/path/to/omp-documenter/scripts/documenter.mjs record --root /absolute/path/to/repository --input /absolute/path/to/review-record.json
```

For a strict check:

```bash
node /absolute/path/to/omp-documenter/scripts/documenter.mjs check --root /absolute/path/to/repository --strict
```

Replace the example absolute paths with real paths. Run from any directory when `--root` is supplied. Use the exact selected repository root, not an arbitrary subdirectory or an unrelated ancestor.

CLI exit status `0` means the requested operation succeeded, `2` means a check or publication conflict was not satisfied, and `1` means invalid input or an error. A successful normal check can still report `complete: false`; use the strict check when assessing whether the defined mechanical completeness requirements are satisfied. Neither check replaces semantic or editorial review.

## 2. State and configuration

Documenter stores repository-local state under `.documenter/`. The helper owns the inventory, ledger, ownership records, journal, and conflict proposals. `inventory.files` records source scope; `inventory.documents` records Markdown pages under the output root for separate factual and editorial review. Read these as needed to understand results; do not edit them to conceal stale evidence or force ownership.

The configuration file is `.documenter/config.json`. Supported configuration concepts are:

| Setting | Purpose |
| --- | --- |
| `docsRoot` | Repository-relative directory where the helper may publish Markdown pages; default `docs/documenter` |
| `exclude` | Explicit path prefixes excluded from content review; report their effect on coverage |
| `maxFileBytes` | Limit for source content inspection, default 2 MiB; accepts an integer from 1 byte to 64 MiB; oversized files remain visible as gaps |
| `gitPolicy.branchMode` | `manual` or `require-docs-branch`; the latter enforces the configured branch prefix for `scan`, `record`, and `publish` |
| `gitPolicy.branchPrefix` | Required prefix when branch enforcement is enabled; default `docs/` |
| `parallel.mode` | `auto` by default, or `off`; controls agent orchestration, not the inventory engine |
| `parallel.maxWorkers` | Maximum review workers, default `3`; accepted range `1` to `8`, bounded by host availability |

Read the actual generated configuration before changing it. Preserve unrelated settings and use values accepted by the installed helper. Configuration changes alter scope and can invalidate earlier coverage; rescan afterward.

Do not exclude difficult files to make a completeness check pass. Exclusions need legitimate reasons visible in the report. The source scanner skips known sensitive filename patterns; this is not comprehensive secret detection. Document configuration names and sources without reading or copying secret values, including secrets that may appear in ordinary source or documentation files.

## 3. Record and publish inputs

The `record` input requires `expectedSnapshot`, the exact lowercase 64-digit hexadecimal snapshot from the scan used for the submitted analysis. It can also contain `reviews`, `claims`, `unknowns`, `retireReviews`, and `retireClaims` arrays. Read [coverage.md](coverage.md) for file and symbol records, [evidence.md](evidence.md) for claim and unknown records, and [maintenance.md](maintenance.md) for explicit retirement. Use repository-relative paths and lowercase hashes from that inventory. A source change anywhere in scope makes an old snapshot unacceptable; investigate the change instead of substituting the newest snapshot into stale findings.

Retirement records have `{path, reason}` for a review or `{id, reason}` for a claim. The helper archives the full original in `ledger.retired` with a timestamp and reason. Use retirement only after removed or replaced behavior has been corrected or visibly flagged in the documentation. It does not waive current review requirements or delete pages.

The `publish` input contains:

| Field | Value |
| --- | --- |
| `path` | Repository-relative `.md` path beneath `docsRoot` |
| `content` | Complete Markdown content for the page |
| `expectedSha256` | `null` for a new file; current exact 64-digit hexadecimal SHA-256 for an existing owned file |

The helper writes only allowed Markdown paths. It rejects unsafe path traversal, unsupported ownership changes, and stale expectations. It preserves proposed content when an existing page cannot be safely replaced. Inspect the result before marking a page updated.

Tool and CLI JSON input is limited to 4 MiB per operation. The engine accepts individual Markdown pages up to 16 MiB, but the wrapper's smaller JSON limit applies when using these interfaces. Keep pages focused and split large references into useful component pages rather than approaching these limits.

Publishing checks the destination page's expectation; the coordinator must also check the live source snapshot before publishing drafts. The required `expectedSnapshot` on the later record operation enforces that the recorded analysis still matches the whole source scope.

## 4. Execution and Git boundaries

The helper performs repository inspection and documentation-state operations. It does not run arbitrary project code, install dependencies, fetch repositories, deploy, start or stop services, or execute migrations. A scan must not trigger those actions indirectly.

Use the host's approval policy for executable verification when necessary. Inspect commands first and prefer isolated existing tests. Record what was run and observed. Lack of permission or runtime access creates a documented gap; it does not justify fabricated results.

Do not impose manual user testing as a completion gate. Complete all authorized checks that can run in the current environment, identify unavailable verification and its practical impact, and finish with the accurate outcome.

The helper does not create branches, stash work, reset files, commit, or push. If project policy requires a documentation branch, perform the authorized branch operation separately after inspecting the working tree. Never overwrite or discard the user's unrelated changes.

Keep `.documenter/` state according to the repository's policy. The inventory can contain filenames, and the ledger can contain operational descriptions; review their suitability before sharing. Do not place secrets in records or proposals.

## 5. Failures and recovery

| Failure | What it means | Correct response |
| --- | --- | --- |
| Source hash or line range rejected | The supplied evidence does not match current content | Rescan, inspect the current source, and create a truthful current record |
| Expected snapshot rejected | Some in-scope source or scope configuration changed after analysis | Investigate the changes and dependent claims; never stamp old findings with a new snapshot |
| Retirement target is unknown | The requested review or claim was never recorded or retired under that identifier | Inspect the ledger and use the actual identifier; do not invent a replacement record |
| Page expectation mismatch | The page changed after the proposed update was prepared | Read both versions and preserve the changed page; use the returned proposal |
| Page is not owned or was manually edited | Automatic replacement would overwrite protected content | Create a concrete proposal or companion page; do not reclaim ownership |
| Unsafe path or symlink detected | A path can escape or violate the protected repository boundary | Use a normal permitted path inside the selected root; investigate the layout |
| Repository lock is held | Another operation may be writing the same state | Wait for the active operation; investigate a stale lock before any removal |
| State is malformed | The helper cannot safely interpret its prior records | Preserve the files and diagnose the schema or interrupted write; do not silently reset history |
| Strict check reports incomplete coverage | Eligible work, unknowns, or gaps remain | Complete accessible work and report the remainder accurately |
| A nested repository or submodule is unavailable | The current root cannot establish that component's behavior | Record the boundary gap and the access or separate review needed |

The journal preserves prior versions before replacement. Inspect the relevant journal and current page before restoring anything. Restore only the intended content using an authorized workflow; a backup's existence does not prove that an automatic restore command exists.

After resolving a problem, repeat only the affected operation and relevant checks. Do not restart the entire repository review unless the underlying scope or baseline changed enough to require it.
