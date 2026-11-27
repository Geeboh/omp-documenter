# OMP Documenter user guide

Version 2.0.0 · 26 November 2026

## Contents

1. [What Documenter does](#1-what-documenter-does)
2. [Install the plugin](#2-install-the-plugin)
3. [Create your first documentation library](#3-create-your-first-documentation-library)
4. [Maintain documentation after code changes](#4-maintain-documentation-after-code-changes)
5. [Use parallel workers](#5-use-parallel-workers)
6. [Read coverage and evidence](#6-read-coverage-and-evidence)
7. [Configure a repository](#7-configure-a-repository)
8. [Protect human-written content](#8-protect-human-written-content)
9. [Use the standalone CLI](#9-use-the-standalone-cli)
10. [Git workflow](#10-git-workflow)
11. [Troubleshoot and recover](#11-troubleshoot-and-recover)
12. [Definition of a useful completed run](#12-definition-of-a-useful-completed-run)
13. [Rebuild a documentation set](#13-rebuild-a-documentation-set)
14. [Local OCR](#14-local-ocr)
15. [Manage pages and recover](#15-manage-pages-and-recover)

## 1. What Documenter does

Documenter examines a repository and helps an OMP agent create an organized documentation library. It supports an initial pass and repeatable maintenance passes. Both use the current source, configuration, tests and other reliable evidence.

The plugin has three parts. The **skill** explains how to investigate and write. The **OMP adapter** exposes convenient commands and an agent tool. The **integrity engine** inventories files, validates evidence locations and content hashes, tracks coverage and safely writes generated Markdown pages.

Clear writing is a required outcome. Procedures should tell the reader where to run commands, what is needed first, what each action does, what success looks like and how to recover when it fails. An API reference should explain the contract and examples, not merely repeat a function name.

Documenter’s core engine has one pinned runtime dependency, `@xberg-io/xberg` 1.5.4, for broad document extraction. Markdown and plain-text workflows remain usable when its native backend is unavailable. Documenter does not install project dependencies or start applications on its own.

## 2. Install the plugin

### Prerequisites

- An existing OMP installation supporting the extension interfaces listed in [validation](VALIDATION.md).
- Node.js 22 or later for the supplied installer, standalone CLI and package tests.
- Read access to the repository, and write access to the chosen documentation and state directories.
- Git available on `PATH` when the target is a Git repository. Non-Git folders are supported with a filesystem inventory.

Check your tools:

```bash
node --version
omp --version
git --version
```

### Install or upgrade from the release wrappers

Download `omp-documenter-install.sh` and `omp-documenter-uninstall.sh` from the `v2.0.2` release. The install wrapper verifies the installer checksum, installs or upgrades an owned directory, performs a no-script dependency install, approves only the pinned Tree-sitter packages, rebuilds native bindings, and links OMP.

```bash
curl -fLO https://github.com/Geeboh/omp-documenter/releases/download/v2.0.2/omp-documenter-install.sh
chmod +x omp-documenter-install.sh
./omp-documenter-install.sh
```

Run the same command to upgrade the default installation. Use `--fresh` only for deliberate replacement. Use `--dir /absolute/path` for another location.

Uninstall the package without touching project `.documenter` state:

```bash
curl -fLO https://github.com/Geeboh/omp-documenter/releases/download/v2.0.2/omp-documenter-uninstall.sh
chmod +x omp-documenter-uninstall.sh
./omp-documenter-uninstall.sh
```

For manual installation, use the self-contained `omp-documenter-2.0.2-install.mjs`, then run `npm install --omit=dev --ignore-scripts`, approve the four pinned Tree-sitter packages with `npm install-scripts approve`, run `npm rebuild`, and link with `omp plugin link`.

Start a new OMP session from the repository root:

```bash
cd /path/to/your/project
omp
```

Expected result: `/documenter` is available, along with the `omp-documenter` skill and `documenter_state` tool. A new session ensures capability discovery sees the linked package. Keep the installed directory in place because the OMP link points to it.

### Use it for one session

If you do not want a persistent plugin link, load the entire package directory for one session:

```bash
cd /path/to/your/project
omp --extension "$HOME/.local/share/omp-documenter-2.0.1"
```

Use the package directory so OMP can discover the bundled skill. Loading only `src/index.js` is not the recommended installation method.

### Is a configuration file required in every repository?

No manual configuration is needed for the default workflow. The first mutating operation creates `.documenter/config.json` with defaults. That file holds this repository's overrides and policies. The OMP package is installed once; evidence and coverage stay with the repository they describe.

## 3. Create your first documentation library

From a normal OMP session at the repository root, run:

```text
/documenter initial
```

Documenter should continue through the following work without pausing merely because it has reached a stage boundary:

1. Read applicable project instructions and existing documentation.
2. Inventory source, configuration, tests, nested components and documentation. Make omitted or unavailable scope visible.
3. Identify readers, entry points, interfaces, data stores, dependencies and important workflows.
4. Divide independent review work among available workers where useful.
5. Investigate behavior and record source evidence, symbol contracts, examples and unknowns.
6. Integrate the findings into clear, consistent chapters.
7. Publish new pages safely; preserve existing human-written pages.
8. Rescan after publication to obtain current page hashes, confirm the source snapshot is unchanged, then record reviews and evidence against that analysis snapshot.
9. Check links, freshness, coverage, clarity and unresolved issues.
10. Report the outcome and the exact remaining gaps.

### Default chapter structure

The skill adapts these chapters to the project. It should avoid empty chapters and explain when a topic is not applicable.

| Location under `docs/documenter/` | Reader's question |
| --- | --- |
| `00-index.md` | Where should I start, and where is each topic? |
| `01-overview.md` | What does this project do, and what is outside its scope? |
| `02-setup.md` | How do I install prerequisites and reach the first useful result? |
| `03-configuration.md` | What can I configure, where, and in what precedence order? |
| `04-architecture.md` | How do components, dependencies and data flows fit together? |
| `05-workflows.md` | How do I complete common tasks? |
| `06-reference/` | What do functions, classes, methods, commands and interfaces accept and return? |
| `07-operations.md` | How do I start, stop, deploy, upgrade, back up and recover the system? |
| `08-security.md` | How do authentication, authorization, secrets and trust boundaries work? |
| `09-troubleshooting.md` | How do I diagnose symptoms and choose corrective actions? |
| `10-testing.md` | How is behavior checked, and which tests have actually been run? |
| `11-contributing.md` | How do developers safely change and maintain the project? |
| `12-glossary.md` | What do unfamiliar names and abbreviations mean? |
| Evidence, coverage and unknowns pages | What supports these statements, and what still needs attention? |

These are a navigation convention, not a claim that the plugin can establish every topic for every project. If deployment is supplied by an unavailable external system, the operations chapter must say that and give the next investigation steps.

### Existing documentation

Useful manual explanations remain authoritative historical/contextual material. Current operational claims still need verification. Documenter can add new companion chapters and flag old statements that conflict with source. It must not silently rewrite a README or remove an explanation because generated prose is shorter.

## 4. Maintain documentation after code changes

Run:

```text
/documenter maintain
```

Maintenance compares current content with the previous inventory, including uncommitted changes. It checks added, changed and deleted paths, affected interfaces, configuration, examples and existing pages. Source changes can invalidate claims elsewhere in the system, so the coordinator must consider dependencies and callers rather than editing only the page named after a changed file.

The initial engine deliberately invalidates source-snapshot records conservatively. A source change can make all previous reviews and claims stale until they are explicitly revalidated. Unchanged file hashes help reuse previous investigation work, but they are not permission to renew every claim blindly. A later dependency-aware engine can narrow this work once the graph is reliable.

Workers include the snapshot they reviewed. The engine refuses to record a payload whose `expectedSnapshot` differs from the live repository. If code changes while workers run, the coordinator refreshes the scope and reassigns affected investigation before recording accepted results.

Maintenance must preserve important manual context, identify unsupported old claims, repair safe generated pages and make incomplete work visible. Unknown facts should become tracked questions with next steps, not plausible-sounding additions.

## 5. Use parallel workers

Parallel work is enabled by policy with a default ceiling of **three review workers plus one coordinator**. It uses OMP's available task tools and routing. The extension does not start an independent agent service.

Good parallel units include separate packages, command/API contracts, operations paths and security boundaries. The coordinator first reads shared entry points and configuration so workers receive relevant context. It then assigns a distinct scope and draft destination to each worker.

Workers return evidence and drafts. The coordinator alone writes the shared ledger, index and final pages. This prevents duplicate editing and lets one final pass enforce terminology, navigation, tone and cross-component correctness.

To reduce concurrency, change the repository configuration:

```json
"parallel": {
  "mode": "auto",
  "maxWorkers": 2
}
```

To run sequentially:

```json
"parallel": {
  "mode": "off",
  "maxWorkers": 1
}
```

These are fields within the complete configuration object, not standalone JSON documents. The full example appears below. Worker availability and host limits take precedence over the requested maximum. No worker tools means a sequential run; it does not block documentation.

Use an ordinary OMP session initially. `/vibe`, `--prewalk`, a goal and automatic approval are not prerequisites. If you already use a project goal, include the Documenter skill in that goal's authorized work. Keep the host's existing permissions; changing approval modes does not make unsupported facts true or authorize overwriting human content.

## 6. Read coverage and evidence

Use:

```text
/documenter status
/documenter check
```

Status reads the current working tree. It does not rely on a possibly old scan file to decide that source evidence is fresh.

In the reports, a **content hash** is a fingerprint of a file's bytes; changing the file changes that fingerprint. A **snapshot** identifies the source files and scope examined together. The **ledger** is the saved collection of review, claim and unknown records. **Ownership** means Documenter has recorded the last page version it generated; it is a publishing safeguard, not a statement about legal ownership.

The report distinguishes inventoried scope, reviewed files, documented files, reviewed documentation pages, current supported claims, stale evidence, declared symbols, explicit exclusions and open unknowns. Some lists are bounded in command output; counts and truncation fields indicate when there are more items in the persisted inventory or ledger.

The following statements mean different things:

- **Inventoried:** the path was found and classified.
- **Reviewed:** the agent recorded an explicit examination of the current content.
- **Documented:** a current review links the file to documentation and a current supported claim.
- **Supported claim:** the agent assessed the evidence, and the engine verified that its files and locations are current.
- **Runtime verified:** a particular command or test actually ran and its result was recorded in a suitable evidence artifact.

File coverage is a bookkeeping measure. It cannot prove that every method, exceptional path or state transition was explained. The skill separately requires a symbol checklist and an editorial review.

`/documenter check --strict` adds completion conditions. A normal check can pass while documentation is incomplete, because it answers the narrower question of whether the recorded mechanical integrity conditions hold. Always read `complete` and the attention lists. A strict failure is a report to work through, not a reason to hide or exclude inconvenient files.

## 7. Configure a repository

After the first scan, edit `.documenter/config.json` if needed:

```json
{
  "version": 1,
  "docsRoot": "docs/documenter",
  "exclude": [],
  "maxFileBytes": 2097152,
  "gitPolicy": {
    "branchMode": "manual",
    "branchPrefix": "docs/"
  },
  "parallel": {
    "mode": "auto",
    "maxWorkers": 3
  }
}
```

| Field | Meaning |
| --- | --- |
| `docsRoot` | Repository-relative root for safely generated Markdown pages. Keep the default when preserving an existing mixed documentation tree. |
| `exclude` | Explicit repository-relative path prefixes. They are prefixes, not wildcard patterns. Use documented reasons in the scope report. |
| `maxFileBytes` | Maximum bytes the engine reads for a source inventory entry. Larger files remain visible as gaps. Default: 2 MiB. |
| `gitPolicy.branchMode` | `manual` leaves branch decisions to your workflow. `require-docs-branch` refuses state and documentation writes unless the current branch has the configured prefix. |
| `gitPolicy.branchPrefix` | Allowed branch prefix when the branch requirement is enabled. |
| `parallel.mode` | `auto` allows bounded delegation; `off` requests sequential analysis. |
| `parallel.maxWorkers` | Requested maximum review workers, from 1 to 8; coordinator excluded. |

Unknown configuration keys are rejected to avoid silent typos. Relative paths cannot escape the repository. Do not put secrets in this file.

Do not use exclusions to manufacture complete coverage. Dependencies, generated output and unavailable scope should be stated in the coverage report. Checked-out submodules and nested repositories are inspected with boundaries recorded. Missing submodules remain explicit gaps until supplied or intentionally excluded under a justified scope decision.

## 8. Protect human-written content

The safe publisher writes Markdown only beneath `docsRoot`. It supports new pages and replacement of its own unchanged pages.

For every replacement, it compares two things: the expected hash supplied by the caller, and its recorded ownership hash. Matching only the current page is insufficient if a human edited that page since generation.

When a conflict occurs, it preserves the existing page and writes a proposed replacement under `.documenter/proposals/`. The agent can explain the proposal, create a new companion page and continue other work. A file saved as a proposal is not a successfully updated page and must not count as one.

To incorporate a proposal into a human page, review the proposed change and apply the desired edits deliberately. That does not automatically transfer future ownership to Documenter. The initial package provides no force-overwrite or automatic-adoption command.

If you want a distinct new generated chapter, publish it at a new, meaningful path and link it appropriately. Do not make renamed copies merely to bypass an ownership conflict.

## 9. Use the standalone CLI

The CLI runs inventory and integrity operations. It does not generate prose or contact a model.

```bash
DOCUMENTER="$HOME/.local/share/omp-documenter-1.0.0"
node "$DOCUMENTER/scripts/documenter.mjs" scan --root /path/to/your/project
node "$DOCUMENTER/scripts/documenter.mjs" status --root /path/to/your/project
node "$DOCUMENTER/scripts/documenter.mjs" check --root /path/to/your/project
node "$DOCUMENTER/scripts/documenter.mjs" check --root /path/to/your/project --strict
```

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | The requested operation succeeded under its stated criteria. |
| `1` | Invalid input, unavailable paths, malformed state or another execution error. |
| `2` | A check did not satisfy its criteria, or publication encountered a protected-content conflict. |

See [engine reference](ENGINE.md) for `record` and `publish` payloads. Batch related review records to reduce repeated full-inventory scans.

## 10. Git workflow

The engine only issues read-only Git commands. It does not create branches, stage files, commit, push, stash, reset, check out submodules or alter your index.

For repositories where a dedicated documentation branch is appropriate:

```bash
cd /path/to/your/project
git status --short
git switch -c docs/documentation-library
```

Inspect existing work before switching branches. Use the project's established workflow when there are ongoing changes. Enabling `require-docs-branch` supplies enforcement; it does not automatically create the branch.

Normally retain configuration, inventory, ledger and page ownership alongside the documentation if project policy allows. These records let later runs identify the previous baseline. Inspect them before committing: paths, summaries and claim text may describe internal implementation.

Proposal drafts, temporary worker files, locks and recovery journals usually do not belong in version control. Add suitable entries to the repository's existing ignore rules if appropriate:

```gitignore
.documenter/write.lock
.documenter/work/
.documenter/proposals/
.documenter/journal/
```

This is a suggested addition; the plugin does not overwrite existing ignore rules. Do not discard state merely to clear a stale result.

## 11. Troubleshoot and recover

| Symptom | Likely explanation | Next action |
| --- | --- | --- |
| `/documenter` is unknown | Package was not discovered in this session. | Check the linked directory and manifest, then start a new OMP session or use explicit package loading. |
| Extension says `pi.zod` is required | Installed OMP lacks the expected extension API. | Check OMP compatibility; the Node CLI remains available for integrity operations. |
| `record` rejects the expected snapshot | Repository content or scan scope changed since investigation. | Rescan, inspect the changes, revalidate affected findings and submit the new snapshot. |
| A generated page will not update | The page changed after publication or after it was read. | Inspect the preserved page and proposal; incorporate only the intended changes. |
| Coverage dropped after a small source edit | Conservative snapshot invalidation protects cross-component claims. | Revalidate the prior findings using unchanged hashes and current dependency context. |
| A source file is a gap | It is unavailable, unreadable, binary, too large, sensitive or a symlink. | Inspect the reason; use appropriate tooling or justify a visible scope exclusion. |
| Worker tool is unavailable | Host configuration does not expose delegation. | Continue sequentially; no worker configuration is required to finish useful work. |
| A write lock remains | A prior process may still be active or may have ended unexpectedly. | Check the recorded process and time. Remove only a confirmed stale lock before retrying. |
| A journal has state `prepared` | Publication may have been interrupted between page and state updates. | Compare the page, ownership hash and saved previous bytes before recovery. |

### Recovering an interrupted update

1. Stop overlapping Documenter writes and keep the current files intact.
2. Read the relevant `.documenter/journal/*.json` record.
3. Compare the current page with the recorded old and new hashes.
4. If a `.before.md` backup exists, inspect it before restoring any content.
5. Preserve any human changes made after the interruption. Use an explicit repair or reviewed restoration rather than blindly copying over the page.
6. Rerun status and integrity checks. If state cannot be reconciled safely, keep the page protected and write a proposal.

The journal assists recovery; it is not an automatic restore command or an immutable audit database.

## 12. Definition of a useful completed run

A run is useful when it produces navigable documentation, identifies what it has examined, preserves existing work and honestly reports what remains unresolved. Complete every independent authorized task before asking for missing external information.

A fully verified scope requires current evidence, reviewed documentation pages, covered components and symbol checklists, coherent architecture and workflows, appropriate examples, valid navigation and no undisclosed gaps. When evidence is unavailable, finish the run as **complete with gaps**, list the questions and next steps, and avoid claiming complete verification.

Manual user testing is not a prerequisite for finishing the documentation run. If a behavior cannot be executed in the available environment, describe the static evidence and mark the runtime result unverified. Do not describe an unexecuted command as tested.

## 13. Rebuild a documentation set

Documenter 2 records a stable documentation-set identity. The destination and front-page policy are repository-relative and persist in `.documenter/sets/`.

Preview before writing:

```bash
node scripts/documenter.mjs preview --root "$PWD" --dest "Project Documentation" --frontpage all
```

Use `overhaul` for a complete guarded run. The deterministic engine archives selected originals, but the coordinating OMP workflow supplies reviewed staged prose.

```bash
node scripts/documenter.mjs plan --root "$PWD" --dest docs --frontpage all --style existing
node scripts/documenter.mjs archive --root "$PWD" --run-id RUN_ID
node scripts/documenter.mjs stage --root "$PWD" --run-id RUN_ID --input staged.json
node scripts/documenter.mjs validate --root "$PWD" --run-id RUN_ID
node scripts/documenter.mjs promote --root "$PWD" --run-id RUN_ID
```

`--frontpage` accepts `none`, `root`, or `all`. `--style existing` reuses an adopted profile or usable project documentation. `--style fresh` selects the versioned built-in profile. `--style-from` requires an accessible local text, Markdown, or HTML source and fails visibly when extraction is unavailable.
Explicit PDF and DOCX style sources use the pinned `@xberg-io/xberg` 1.5.4 backend through the shared engine. `doctor` reports formats, extractors, renderers, OCR backends and missing models. Generic authenticated acquisition accepts only an origin allow-list and an environment-variable credential reference. Login pages, redirects and rejected credentials remain unresolved sources. Transient HTTP failures use bounded retries; authentication failures do not retry. Authenticated responses are bounded at 64 MiB.

## 14. Local OCR

Documenter uses the installed Xberg Tesseract path for local OCR. OCR stays offline after model provisioning. The default English and orientation models are verified through the signed Debian package installation and exact installed-file digests. The current default is the distribution model profile, not `tessdata_best`.

```bash
node scripts/documenter.mjs ocr status --root "$PWD"
node scripts/documenter.mjs ocr doctor --root "$PWD" --fixture /path/to/image-only-scan.png --expected-phrase "Known phrase"
node scripts/documenter.mjs ocr models list --root "$PWD"
node scripts/documenter.mjs ocr models verify --root "$PWD"
node scripts/documenter.mjs ocr test --root "$PWD" --file /path/to/scan.png --expected-phrase "Known phrase"
```

`doctor` requires a real raster fixture. Missing or corrupt models return `OCR_REQUIRED` or a checksum failure. Model installation accepts a local verified `.traineddata` file and never downloads assets during extraction. OCR receipts record backend, languages, model digest, confidence, source identity and extraction configuration identity. OCR processing is separate from LLM token usage.

External output, semantic search, proprietary reference adapters, and automatic section merging are not core capabilities. The engine preserves non-Markdown assets and reports unsupported formats.

## 15. Manage pages and recover

Accept only after an independent page review has checked the current bytes and affected claims. The deterministic engine records the accepted hash; it does not supply semantic review itself.
```bash
node scripts/documenter.mjs page --root "$PWD" --operation accept --path docs/guide.md --expected-sha256 HASH
node scripts/documenter.mjs page --root "$PWD" --operation release --path docs/guide.md --expected-sha256 HASH
node scripts/documenter.mjs archives --root "$PWD"
node scripts/documenter.mjs doctor --root "$PWD"
node scripts/documenter.mjs resume --root "$PWD" --run-id RUN_ID
node scripts/documenter.mjs restore --root "$PWD" --archive-id ARCHIVE_ID --dry-run
```

Promotion uses per-file guards and a journal. A changed page creates a conflict. Preserve the newer edit and resolve it through the page lifecycle. Do not use `git reset --hard`, `git clean -fd`, or `rm -rf .documenter` for recovery.

## 15. Isolate OMP extension loading

If another installed OMP plugin fails during automatic discovery, do not uninstall or modify it. Start Documenter through its isolated launcher:

```bash
node /path/to/omp-documenter/scripts/omp-documenter-host.mjs
```

The launcher passes `--no-extensions` and explicitly loads Documenter. Additional extensions can be supplied deliberately after the launcher arguments. The wrapper does not change OMP configuration or installed plugins.
