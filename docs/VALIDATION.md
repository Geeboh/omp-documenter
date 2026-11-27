# Validation and limits

## Current v2 candidate

- Package version: 2.0.0.
- Candidate working revision: see the workspace-only `.overhaul/documenter-v2/work/RELEASE-EVIDENCE.md`; release artifacts are generated separately and `.overhaul` is not shipped.
- Runtime: Node.js v24.22.3 on Linux x64.
- Runtime dependencies: Node built-ins; Git for Git-repository fixtures; repository-local Android Open Source Project Xberg fixtures under `tests/fixtures/xberg/`.
- Automated suite: `npm test`.
- Result: **98 tests passed; 0 failed; 0 skipped.**

The release target is Node.js 22 or later. Node.js 22.23.5, 24.22.3, and 26.13.1 passed the product suite and syntax checks. Bun 1.4.5 passed the current 98-test suite. Local Tesseract OCR passed real raster and image-only PDF qualification. OMP 19.2.1 read/write tool qualification is partial.

## What the automated tests establish

| Area | Observed result |
| --- | --- |
| Initial inventory | Scanning alone gives no review or documentation credit. |
| Freshness | Live status sees additions, changes and deletions, including unrelated source changes. |
| Worker handoff | Records from a stale source snapshot are rejected. |
| Evidence validation | Incorrect hashes, invalid ranges and missing uncertainty explanations are rejected. |
| Empty files | Evidence uses exactly `0,0`; empty repositories are not declared complete. |
| Manual content | Existing manual pages and manually edited generated pages are preserved. |
| Concurrent page edit | An edit during replacement preparation is preserved and a proposal is saved. |
| Retirement | Deleted-source records can be archived with their original contents and reasons. |
| Documentation audit | Existing and generated pages require explicit review; manual pages are visible to link checks. |
| Repository scope | Nested repositories, unavailable submodules, ignored paths and sensitive filename patterns are handled explicitly. |
| File boundaries | Traversal, symbolic links, hardlinked outputs and unsafe state paths are refused. |
| Git inspection | Repository fsmonitor callbacks are disabled and inherited Git routing variables do not redirect the scan. |
| Writer coordination | Existing locks are not stolen and normal failures release acquired locks. |
| Branch policy | Required branch prefixes are enforced without Git mutations. |
| Local Markdown links | The implemented file/heading subset detects broken local references. |
| OMP adapter with mock host | Commands register without startup writes, modes start or queue appropriately, roots are bounded, errors are marked, and human status preserves totals. |
| CLI | Exit codes distinguish success, invalid input and incomplete/conflicting results. |
| Distribution | The installer reproduces every packaged file byte-for-byte, refuses existing destinations and refuses symlinked destination parents. |

Tests establish these observed cases, not correctness for all possible repositories or concurrent filesystem behavior.

## Roadmap adapter qualification

- `scripts/omp-host-matrix.mjs` passed against the installed `omp/19.2.1` executable. It records version and isolated extension-load results without shell interpretation. Missing hosts remain `unavailable` unless `--require-host` is supplied.
- `lib/symbols.mjs` now uses Tree-sitter `0.21.1` with JavaScript `0.23.1`, Python `0.23.3` and TypeScript `0.23.2` grammars when available, with lexical fallback and explicit non-exhaustive semantic limits.
- `lib/optional-capabilities.mjs` provides explicit dependency/impact traversal, baseline-preserving Markdown section merge receipts, and content-addressed lexical indexing with add/change/remove invalidation.
- `lib/verification.mjs` records bounded argv-example execution receipts and detects MkDocs, Docusaurus and Sphinx configuration. Renderer execution remains explicit and unclaimed until a project command runs.
- `.github/workflows/ci.yml` includes an `integrity` job for example receipts, renderer detection, host probing, tests and syntax checks.
- Current documentation target is GitHub-rendered Markdown with images and local links. Full site creation and hosted renderer execution are deferred to the long-distance roadmap.
- Semantic search remains disabled without a measured semantic backend. Indexed lexical search is the supported deterministic fallback.

## Offline semantic-search baseline

The repository-local baseline uses 15 documents, 10 source files, 5 Markdown pages, JavaScript, TypeScript and Python, 20 queries, top-3 retrieval and 5 repetitions. Offline mode uses no network, embeddings or external model.

The starting budgets are a serialized index under 128 KiB, average query latency under 5 ms and p95 latency under 10 ms. Five runs passed with 100% expected-path recall at top 3. The index was 32,243 bytes. Median run average latency was 0.010 ms. Median p95 latency was 0.019 ms.

This is a synthetic smoke baseline, not a capacity or semantic-quality claim. Evidence is in `.overhaul/documenter-v2/work/SEMANTIC-SEARCH-EVIDENCE.json`.

## Real GitHub lexical ranking comparison

The offline evaluator ran against three pinned GitHub repositories: `psf/requests`, `fastapi/fastapi` and `sindresorhus/p-map`. The corpus contained 3,092 text documents and 50 hand-labeled queries. Each ranking mode ran five repetitions at top 5 with no network, embeddings or external models.

The overlap ranker reached 0.640 top-5 recall and 0.5377 mean reciprocal rank. Optimized `weighted-v1` reached 0.700 recall and 0.7133 mean reciprocal rank. This is a +0.060 recall gain and +0.1757 MRR gain, or +32.67% relative MRR.

Median aggregate average latency was 0.268 ms for overlap and 10.825 ms for weighted-v1. Median aggregate p95 latency was 0.657 ms and 21.108 ms. Candidate scoring now uses query-token postings and avoids per-document field Set allocation, but weighted-v1 remains much slower.

Overlap remains the default ranking. Weighted-v1 stays opt-in because ranking gains justify retaining a candidate, not changing the default. Evidence is in `.overhaul/documenter-v2/work/REAL-REPO-LEXICAL-EVIDENCE.json`.

## Normal OMP profile qualification

Normal OMP `19.2.1` status, check and initial dry-run dispatch completed without an error result. Interactive fixture attempts emitted only session and extension notices, with no model turn, tool call, approval event or worker event. Busy scheduling, approval prompts, worker execution and worker fallback remain unqualified. No unrelated OMP plugins were modified. Evidence is `.overhaul/documenter-v2/work/NORMAL-OMP-QUALIFICATION.json`.

## Independent skill exercise

The skill was exercised separately against a small local JavaScript repository containing configuration code, a URL-description function, tests and pre-existing operator notes. This exercise used the standalone CLI rather than a live OMP host.

The run created 11 pages and preserved the original operator page byte-for-byte. It reviewed and documented all 4 source/configuration/test files and separately reviewed all 12 documentation pages. The existing fixture tests passed 2/2, and inspected local smoke examples ran successfully.

The agent correctly distinguished a function returning a launch URL from an actual service implementation. It retained the operator's mounted-volume note as attributed knowledge, identified an absent startup script, and explained that a configured port can differ from the code default. It did not invent a deployment or minimum supported runtime.

The final report retained 3 open unknowns and 3 unsettled claims, with no stale records or broken local links. It reported **complete with gaps**, and both mechanical checks remained unsuccessful because the unknown/conflicting claims were intentionally retained. This is the expected honest outcome for missing external evidence; all-files-reviewed coverage did not become a claim of complete verification.

This small exercise is evidence that the skill can follow the workflow on a realistic ambiguity. It does not establish quality, speed or cost across large repositories or actual parallel OMP workers.

## OMP API evidence

The adapter follows current upstream documentation for an extension factory, `omp.extensions`, conventional sibling skills, command/tool registration, injected `pi.zod`, `sendUserMessage` scheduling and `isError` results. Relevant source links are listed in [architecture](ARCHITECTURE.md#upstream-references).

The adapter's mock-host tests are supplemented by live OMP 19.2.1 extension loading and read/write tool invocations. An unrelated auto-loaded plugin reports an API compatibility error; busy scheduling, approval prompts, and worker fallback remain unqualified. Bun 1.4.5 is qualified for the product suite.
The isolated OMP launcher returned public OCR `status` and `doctor` reports and a live `documenter_inspect status` tool result in JSON mode using the repository-local fixture. Normal-profile scheduling, approval prompts, worker fallback and unrelated-plugin compatibility remain partial.

## Benchmark qualification

The starting profile uses 50 source files and 100 broken links, five alternating repetitions per operation, a three-worker controller, a four-core benchmark budget, a 1 GiB memory budget and a 1 MiB result limit. Pass thresholds are five successful repetitions, status median under 100 ms, check median under 150 ms, RSS delta under 64 MiB, and exact fixture totals.

On Node.js v24.22.3 Linux x64 with 16 logical CPUs, 384 GiB RAM and no swap, `status` measured a 7.837 ms median and `check` a 13.609 ms median. Maximum RSS deltas were 4.0 MiB and 3.4 MiB. The fixture is synthetic. Host load was elevated by a concurrent local llama server, so these are smoke thresholds, not capacity claims. CPU profiling identified engine traversal plus synchronous filesystem and process work as the observed limiter.

## Limits that must remain visible

1. The engine checks recorded evidence and freshness; the agent must establish semantic support.
2. Symbol lists are agent-declared. No universal parser, complete call graph or exhaustive symbol denominator is implemented.
3. Source-snapshot invalidation is conservative. Dependency-specific incremental revalidation is a future improvement.
4. The publisher protects whole pages. It does not automatically merge human prose or adopt manually edited pages.
5. File and documentation coverage are scoped measures. Report ignored paths, exclusions, binary/unavailable inputs and non-Markdown documentation formats separately.
6. Markdown link checks cover the documented subset. Complex syntax, remote URLs and renderer-specific behavior require separate checks.
7. Parallel-worker configuration directs the skill to use the host's available tools. It is not an independent worker scheduler or model router.
8. Filename-based secret handling is incomplete by nature. The agent must avoid leaking secrets found in unexpected locations.
9. The writer lock coordinates cooperating Documenter operations. It does not prevent external editors from writing.
10. Journals support recovery, but page content and ownership are not one atomic transaction. A crash may require a reviewed repair.
11. No deployment commands, application services, package installations or repository test suites are run by the engine. Runtime verification is a separate authorized agent action.

## Reproduce the package checks

From the installed package directory:

```bash
node --test tests/*.test.mjs
node --check src/index.js
node --check lib/engine.mjs
node --check scripts/documenter.mjs
node --check scripts/build-distribution.mjs
```

To create a new self-contained installer from the installed source:

```bash
node scripts/build-distribution.mjs /absolute/path/to/new-installer.mjs
```

The output path must not already exist. The build includes code, skill references, templates, tests and user documentation; it does not include `.documenter` state, a `.git` directory, dependencies or unrelated workspace files.
