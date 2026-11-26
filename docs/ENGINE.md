# Integrity engine reference

## Contents

- [Interface](#interface)
- [State files](#state-files)
- [Inventory](#inventory)
- [Recording findings](#recording-findings)
- [Publishing pages](#publishing-pages)
- [Coverage and checks](#coverage-and-checks)
- [Concurrency and recovery](#concurrency-and-recovery)

## Interface

The engine is plain JavaScript ESM and uses Node built-ins. Its exported function is synchronous:

```javascript
import { runOperation } from "./lib/engine.mjs";

const report = runOperation("status", {
  root: "/absolute/path/to/repository"
});
```

Actions are `scan`, `status`, `record`, `publish` and `check`. Unknown actions and invalid payloads throw an actionable error. Expected integrity failures or publishing conflicts return `ok: false`.

### OMP tool

The `documenter_state` tool has this outer shape:

```json
{
  "action": "record",
  "root": ".",
  "inputJson": "{\"expectedSnapshot\":\"REPLACE_WITH_REAL_SNAPSHOT\",\"reviews\":[]}",
  "strict": false
}
```

This is an illustrative shape; the placeholder is not a valid snapshot. `inputJson` is a JSON **string**, avoiding a provider-specific freeform schema. Omit it for scan, status and check. `root` is optional and limited to the session directory or one of its descendants. Only `check` uses `strict`.

The tool is classified as a write capability because some of its actions write state and pages. Its result has both human-readable text and structured details. Errors are marked with top-level `isError: true`. The package does not bypass the host's approval policy.

### CLI

```bash
node /absolute/plugin/scripts/documenter.mjs ACTION --root /absolute/repository
node /absolute/plugin/scripts/documenter.mjs record --root /absolute/repository --input /absolute/records.json
node /absolute/plugin/scripts/documenter.mjs publish --root /absolute/repository --input /absolute/page.json
node /absolute/plugin/scripts/documenter.mjs check --root /absolute/repository --strict
```

`record` and `publish` require `--input`. The standalone CLI accepts a regular JSON input file of at most 16 MiB. The OMP tool limits serialized `inputJson` to 4 MiB. Exit status is 0 for successful operations, 1 for errors, and 2 for a failed check or a protected-content publishing conflict.

## State files

All paths below are relative to the selected repository root:

| Path | Role |
| --- | --- |
| `.documenter/config.json` | Validated configuration, created on the first mutating operation. |
| `.documenter/inventory.json` | Latest persisted scan with source files, output pages, hashes, boundaries and scope. |
| `.documenter/ledger.json` | Active reviews, claims, unknowns and archived retired records. |
| `.documenter/ownership.json` | Last published hash for generated pages. |
| `.documenter/write.lock` | Exclusive lock for a cooperating writer; contains its process and start time. |
| `.documenter/journal/` | Prepared/committed publication records and previous page bytes when replacing content. |
| `.documenter/proposals/` | Proposed content and metadata after a safe publisher refuses a conflicting update. |
| `.documenter/work/` | Optional uniquely named worker drafts and task input files; managed by the coordinating agent. |

The first five operations do not all write the same files. `scan` writes the inventory. `record` writes the ledger. `publish` writes a page and publication state. `status` and `check` read live inputs without creating state. An invalid mutating operation may create configuration and release its lock, but it must not falsely mark a review or page update successful.

Do not manually edit ownership or evidence records to clear a failure. Configuration is user-editable within its documented schema. Other files are mechanically owned state; repair them only through an explicit investigated recovery.

## Inventory

In Git repositories, inventory combines tracked files with nonignored untracked files. Tracked files are not hidden merely because an ignore rule matches them. Ignored paths are disclosed separately. Available nested repositories and checked-out submodules are inspected recursively; their boundaries and available revision metadata are recorded. Missing submodules remain gaps.

Without Git, inventory walks local directories. It omits version-control internals, dependency/cache folders and configured output/state paths, while reporting applicable exclusions. It does not follow source symlinks. Special files, unreadable files, oversize files, sensitive filename patterns, binary files and non-UTF-8 content become explicit gaps rather than reviewed text.

The engine does not execute source code. Its Git calls disable hooks and `core.fsmonitor`, use no shell interpolation, and remove inherited Git routing variables before setting controlled read-only options. No fetch, checkout, package installation or repository test execution occurs.

### Source and documentation snapshots

`inventory.files` contains eligible source, configuration, tests and documentation outside `docsRoot`, together with gap entries. Eligible files include `path`, `sha256`, `bytes`, `lines` and `kind`.

`inventory.documents` separately inventories Markdown pages below `docsRoot`, including pre-existing human-owned pages. Creating a generated page does not change the source snapshot or imply that the page has been reviewed. Non-Markdown assets beneath `docsRoot` are outside this page-audit denominator.

`snapshot` identifies the source inventory and declared scope. `documentSnapshot` identifies the output-page inventory. A claim/review is bound to the source snapshot plus individual file and document hashes. A change anywhere in the source snapshot conservatively invalidates older scoped assessments.

The engine tracks working-tree contents, not just a Git commit. This includes uncommitted content. Snapshot hashes are useful integrity markers, not digital signatures or semantic proof.

### Bounded output

Command results limit long attention and change lists to 100 items. Counts and `truncation` fields retain the actual totals. The complete latest persisted scan is in `inventory.json`; use a new `scan` if a full current manifest is required. `status` and `check` calculate live results but do not overwrite that persisted scan.

## Recording findings

`record` accepts this top-level shape:

```json
{
  "expectedSnapshot": "REPLACE_WITH_THE_ACTUAL_64_HEX_SNAPSHOT",
  "reviews": [],
  "claims": [],
  "unknowns": [],
  "retireReviews": [],
  "retireClaims": []
}
```

`expectedSnapshot` is required. Other arrays may be omitted. All payload keys are validated; unknown fields fail instead of being silently ignored.

The source snapshot must equal the live inventory both before validation and immediately before the ledger is written. Referenced source hashes and document hashes must also match. This prevents an old worker result from silently acquiring a new snapshot after a dependency changes.

Use a meaningful summary for every review. A field existing in JSON does not make the claimed examination honest; the agent must actually do the review.

### File review

```json
{
  "path": "src/config.js",
  "sha256": "REPLACE_WITH_ACTUAL_HASH",
  "summary": "Inspected the configuration parser, its callers and error paths; verified the documented defaults and precedence.",
  "documents": ["docs/documenter/03-configuration.md"],
  "symbols": [
    {
      "name": "readConfig",
      "kind": "function",
      "signature": "readConfig(env = {})",
      "doc": "docs/documenter/06-reference/config.md#readconfig",
      "notes": "Document accepted inputs, result fields and thrown errors from the actual implementation."
    }
  ]
}
```

This example illustrates fields; its paths, signature and claims must be replaced with actual repository evidence. `symbols` is agent-declared. Its `doc` field is a nonempty reference string; the engine does not resolve that field as a formal symbol index or guarantee exhaustive symbol coverage. The agent must verify that mapping.

A page beneath `docsRoot` is reviewed with the same object shape, its current page hash, a factual/editorial summary, and typically empty `documents` and `symbols` arrays. Run `scan` again after publication to refresh `inventory.documents`, confirm that the source snapshot still matches the analysis, and obtain the current page hashes. `publish` does not refresh the persisted inventory.

### Claim

```json
{
  "id": "C-CONFIG-001",
  "text": "Replace this with a bounded statement established from the inspected source.",
  "status": "supported",
  "evidence": [
    {
      "path": "src/config.js",
      "sha256": "REPLACE_WITH_ACTUAL_HASH",
      "startLine": 1,
      "endLine": 8
    }
  ],
  "documents": ["docs/documenter/03-configuration.md"]
}
```

Stable IDs allow later updates. Re-recording the same ID replaces its active claim; the old ledger file is not an immutable audit log.

`status` accepts `supported`, `inference`, `unknown` or `conflict`. A supported claim needs at least one evidence reference. Each other state requires nonempty `reason` and `resolution` strings. Evidence ranges are inclusive positive line numbers, except exactly `startLine: 0, endLine: 0` for a verified zero-byte file.

The engine checks the path, current hash and valid line range. It does not determine whether those lines support the words in `text`. Source references must be read and interpreted by the reviewing agent.

### Unknown

```json
{
  "id": "U-DEPLOY-001",
  "question": "Which external launcher supplies the production configuration?",
  "whyItMatters": "The repository alone cannot establish deployed defaults or startup behavior.",
  "nextSteps": ["Obtain the deployment definition for the documented environment and trace its configuration inputs."],
  "status": "open"
}
```

An unknown requires a question, impact, at least one next step and status `open` or `resolved`. A resolved entry also requires a `resolution` string. Establish the resolution with evidence before closing it; the engine cannot validate the truth of a free-text resolution.

### Retirement after deletion or replacement

```json
{
  "expectedSnapshot": "REPLACE_WITH_CURRENT_ANALYSIS_SNAPSHOT",
  "retireReviews": [
    { "path": "src/removed-module.js", "reason": "Module removed; the affected API and architecture pages now describe its replacement." }
  ],
  "retireClaims": [
    { "id": "C-OLD-001", "reason": "The removed implementation no longer supports this claim; current documentation identifies the replacement." }
  ]
}
```

Retirement archives the complete old record, reason and timestamp in `ledger.retired`. Already-retired entries are idempotent; nonexistent entries are rejected. Retire records only after correcting affected documentation. Retiring a current file's review lowers coverage and does not make its documentation complete.

## Publishing pages

New page:

```json
{
  "path": "docs/documenter/01-overview.md",
  "content": "# Project overview\n\nReplace this example with verified, useful documentation.\n",
  "expectedSha256": null
}
```

Existing generated page: provide its current lowercase SHA-256 instead of `null`. The publisher requires both that hash and its recorded ownership hash to equal the page's current bytes. It never automatically adopts an existing human page.

Allowed destinations are normalized repository-relative `.md` paths below `docsRoot`. Traversal, symbolic-link components, hardlinked output files and nonregular destinations are rejected. Parent directories are checked. The publisher rechecks the destination after preparing its journal to catch edits during preparation.

Expected conflicts return `ok: false`, `conflict: true`, a reason and the saved proposal path. The original page remains unchanged. Invalid/unsafe paths throw an error rather than producing an unsafe proposal.

Publication checks destination integrity, not semantic support or source-snapshot freshness. The coordinator must check the live source snapshot before publication, and then submit findings with the original `expectedSnapshot`. A later record rejection must be investigated and any already-written draft flagged or corrected before the run is reported complete.

## Coverage and checks

| Field | Definition |
| --- | --- |
| `coverage.reviewed` | Eligible source/outside-output files with a current review. |
| `coverage.documented` | Current reviewed source files linked to a present document and a current supported claim referencing that source and a shared document. |
| `coverage.documentationPages` | Markdown pages beneath `docsRoot` with a current explicit page review. |
| `coverage.claims` | Total active, current, supported, inference and stale claim counts. |
| `coverage.symbols` | Number of agent-declared symbols on current source reviews; basis is `declared_only/not_exhaustive`. |
| `attention` | Pending source/page reviews, missing documentation, stale records/pages, gaps, unknowns and unsettled claims. |

If there are no eligible source files, the percentage is `null`, and the engine does not claim complete documentation of an empty scope.

Normal `check` tests the implemented mechanical integrity conditions, including stale reviews/claims/pages, local link failures and unsettled unknown/conflict claims. Strict checking also requires complete declared source and output-page review coverage, supported documentation, no source/documentation gaps and no open unknowns.

The current link checker covers local inline Markdown links and ATX headings or explicit HTML anchors. It reports its limited scope. It does not validate remote availability, reference-style links, nested destinations, site-root routing or every renderer's slug rules. A project renderer or explicit agent review must handle those cases.

Neither `ok: true` nor `complete: true` establishes exhaustive semantic correctness, runtime behavior or security. They describe the recorded mechanical conditions. The skill adds semantic, symbol and editorial acceptance criteria.

## Concurrency and recovery

Only one cooperating engine writer can hold `.documenter/write.lock`. Parallel review workers do not write shared state or final pages. The coordinator batches records and publishes serially.

Writes use a temporary file, synchronization and atomic replacement or an exclusive new-file operation. Replacements save prior page bytes in a journal. Page content and its ownership/ledger records are separate filesystem writes, so a crash can leave a prepared journal. Inspect the journal, current hashes and protected content before a deliberate repair.

The path checks protect ordinary workflows but do not form a sandbox against an adversarial process racing filesystem changes. An external editor can still change files outside the cooperative lock. Current hashes are checked again where implemented, and the final run must include a fresh integrity check.

## V2 lifecycle actions

Documenter 2.0.0 keeps the five v1 actions and adds guarded lifecycle actions:
`preview`, `plan`, `overhaul`, `archive`, `stage`, `validate`, `promote`,
`resume`, `archives`, `restore`, `page`, `style`, `doctor` and `details`.

Preview is read-only. It resolves the repository-relative destination, exact
front-page policy and Existing/Fresh style without creating state. A planned
run records source and document hashes, style identity, destination, selected
pages and an idempotency key. Archive, stage, validate and promote are separate
durable transitions. Promotion refuses source or document drift and records a
per-page journal.

Example:

```bash
node scripts/documenter.mjs preview --root "$PWD" --dest "Project Documentation" --frontpage all
node scripts/documenter.mjs plan --root "$PWD" --dest docs --frontpage root --style fresh
```

Create the staged page input as JSON. A path must be inside the planned destination or be an exact selected front page in the immutable plan.

```json
{"pages":[{"path":"docs/README.md","content":"# Project\n"}]}
```

Then run:

```bash
node scripts/documenter.mjs stage --root "$PWD" --run-id RUN_ID --input staged.json
node scripts/documenter.mjs validate --root "$PWD" --run-id RUN_ID
node scripts/documenter.mjs promote --root "$PWD" --run-id RUN_ID
```
Use the returned `runId` with `archive`, `stage`, `validate`, `promote` and
`resume`. Use `archives` to inspect verified originals and `restore` with an
explicit archive ID. `page` supports `accept`, `release`, `rename` and
`retire`; `style` supports `show`, `import` and `refresh`.

The v2 engine writes repository-local `.documenter/sets.json`, styles, runs,
archives and generation manifests. External output destinations are rejected.
The engine does not generate prose. A staged page must be supplied by the
coordinating documentation workflow and remains subject to exact-byte checks.

## Example and renderer checks

Run explicit examples through argv arrays. The harness does not interpret shell syntax.

```bash
node scripts/verify-examples.mjs --root "$PWD" --input examples.json --output example-receipt.json
node scripts/renderer-check.mjs --root "$PWD"
```

Example receipts record command, working directory, exit status, bounded output and output hash. The harness does not claim network or filesystem sandboxing. Renderer detection reports project configuration; renderer-specific anchors remain unverified until an explicit project check runs.

`scan-v2` also returns bounded JavaScript-family and Python declaration inventories. These are non-exhaustive. Dynamic dispatch, decorators, generated code, reflection and runtime registration remain explicit limitations.

## Optional expanded capabilities

The expanded release includes deterministic, guarded optional adapters:

```bash
node scripts/optional-capabilities.mjs search search.json
node scripts/optional-capabilities.mjs merge merge.json
node scripts/optional-capabilities.mjs external external-output.json
```

Search is lexical fallback with evidence links, not embedding proof. Merge is heading-identity three-way merge with explicit conflicts. External output requires `allowExternalOutput: true`, rejects traversal and overwrite, and reports per-file atomicity limits.

## Native token usage

Documenter has its own optional usage ledger. It does not require Tersio.

```bash
node scripts/documenter-usage.mjs sync --root "$PWD" --input host-usage.jsonl
node scripts/documenter-usage.mjs stats --root "$PWD"
```

The sync accepts explicit JSONL usage records, normalizes provider fields into input, output, cache-read, cache-write, and cost buckets, skips unchanged files, deduplicates stable IDs, and stores local state under `.documenter/`. Missing host usage remains `unavailable`; text-length estimates are never presented as measured tokens.
