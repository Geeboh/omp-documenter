# Validation and limits

## Current v2 candidate

- Package version: 2.0.0.
- Candidate working revision: see the workspace-only `.overhaul/documenter-v2/work/RELEASE-EVIDENCE.md`; release artifacts are generated separately and `.overhaul` is not shipped.
- Runtime: Node.js v24.22.3 on Linux x64.
- Runtime dependencies: Node built-ins; Git for Git-repository fixtures.
- Automated suite: `npm test`.
- Result: **70 tests passed; 0 failed.**

The release target is Node.js 22 or later. Node.js 22 and 26 were not available for this qualification run. OMP 19.2.1 was observed, but live plugin qualification was not run. Bun was unavailable. The historical v1 result below is retained as baseline evidence, not current v2 proof.

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

## Independent skill exercise

The skill was exercised separately against a small local JavaScript repository containing configuration code, a URL-description function, tests and pre-existing operator notes. This exercise used the standalone CLI rather than a live OMP host.

The run created 11 pages and preserved the original operator page byte-for-byte. It reviewed and documented all 4 source/configuration/test files and separately reviewed all 12 documentation pages. The existing fixture tests passed 2/2, and inspected local smoke examples ran successfully.

The agent correctly distinguished a function returning a launch URL from an actual service implementation. It retained the operator's mounted-volume note as attributed knowledge, identified an absent startup script, and explained that a configured port can differ from the code default. It did not invent a deployment or minimum supported runtime.

The final report retained 3 open unknowns and 3 unsettled claims, with no stale records or broken local links. It reported **complete with gaps**, and both mechanical checks remained unsuccessful because the unknown/conflicting claims were intentionally retained. This is the expected honest outcome for missing external evidence; all-files-reviewed coverage did not become a claim of complete verification.

This small exercise is evidence that the skill can follow the workflow on a realistic ambiguity. It does not establish quality, speed or cost across large repositories or actual parallel OMP workers.

## OMP API evidence

The adapter follows current upstream documentation for an extension factory, `omp.extensions`, conventional sibling skills, command/tool registration, injected `pi.zod`, `sendUserMessage` scheduling and `isError` results. Relevant source links are listed in [architecture](ARCHITECTURE.md#upstream-references).

This is **source-backed integration design plus a mock-host test**, not proof that the user's installed OMP release has already loaded the package. No OMP executable or Bun runtime was available for a live host run in this workspace. The package leaves that limitation explicit; it does not require user testing before the documentation workflow can finish accessible work.

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
