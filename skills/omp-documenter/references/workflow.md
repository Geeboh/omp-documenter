# Repository documentation workflow

## Contents

1. Establish scope and baseline
2. Investigate the repository
3. Plan the library
4. Document code and contracts
5. Run initial documentation
6. Run maintenance
7. Checkpoint and finish

## 1. Establish scope and baseline

Work from the repository root selected by the user or the active OMP session. Do not silently move to a parent repository. If the current directory is a nested module, inspect the parent boundary and explain the selected scope before claiming repository-wide coverage.

Read applicable project instructions, root manifests, existing indexes, and documentation conventions. Inspect Git status without altering user changes. Preserve the user's terminology and established documentation structure when they work well; introduce an index that connects them rather than relocating everything.

Run the inventory helper. Inspect its manifest as well as the compact response: a summary cannot show every component. Write down:

| Scope item | Required decision |
| --- | --- |
| First-party source and nested modules | Include in review, including internal code |
| Existing documentation and examples | Review for useful content, contradictions, and missing topics |
| Tests and fixtures | Inspect what they assert and which behavior they cover |
| Build and dependency manifests | Establish declared versions, entry points, and build steps |
| Configuration and deployment definitions | Establish defaults, overrides, environment assumptions, and operational behavior |
| Generated code | Identify its source and generator; justify whether source, output, or both need review |
| Vendored and third-party code | Identify integration points and excluded scope; do not imply it was reviewed |
| Submodules and nested repositories | Identify each boundary, availability, revision where observable, and review strategy |
| Ignored, binary, oversized, inaccessible, or sensitive files | Record the reason and effect on coverage |
| External services or unavailable systems | Record what the repository establishes and what requires external evidence |

An inventory's exclusions describe what was not read; they do not establish that omitted material is irrelevant. Never advertise an exhaustive physical-disk scan when Git ignore rules or configured exclusions limited discovery.

The helper recursively inventories locally available nested Git repositories and checked-out submodules, recording their boundaries. Inspect their entries as part of the selected root's scope. An unavailable or uninitialized submodule remains a visible gap; scanning does not fetch it. If a boundary still cannot be inspected, record the reason. Where a separate authorized run is necessary, link its report and report its distinct denominator; do not add percentages with different denominators.

## 2. Investigate the repository

Start with actual executable entry points, not folder names. Read the entry point, the functions it invokes, the configuration that influences those functions, and their relevant tests. Follow responsibility until the behavior can be explained without guessing.

Build a component map with these fields:

| Field | What to establish |
| --- | --- |
| Responsibility | The concrete work the component performs |
| Entry points | CLI commands, routes, events, exported APIs, scheduled work, or startup hooks |
| Inputs and outputs | Types, schemas, constraints, serialization, and error forms |
| Dependencies | Direct calls, packages, processes, storage, and external services |
| State | What is persisted, cached, mutable, or shared |
| Lifecycle | Initialization, use, shutdown, cleanup, and restart behavior |
| Trust boundary | Which identity controls each input and which permissions the operation needs |
| Evidence | Relevant source locations and current hashes |

For data flows, follow a representative real input through validation, transformation, persistence, and output. Include alternate and failure paths when they materially change the result. An import relationship alone does not prove a runtime call or a complete data flow.

Use repository-aware search, language services, or existing parsers when available. Do not add new tooling merely to avoid reading a small file. Treat extractor output as a navigation aid until reviewed. Account for dynamic dispatch, generated interfaces, reflection, macros, decorators, and environment-dependent paths as explicit limitations when necessary.

Batch independent module reviews in parallel when files and responsibilities are clearly assigned. Default to up to three workers when available and useful. Require each reviewer to return inspected paths, exact evidence, document mappings, unknowns, and an actual summary. Follow [parallel.md](parallel.md); the coordinator owns cross-component consistency, shared writes, and the final coverage report.

## 3. Plan the library

Default to `docs/documenter/`, or the configured `docsRoot`. Adapt this map to a good existing structure. Do not create empty chapters just to match the map.

| Page or section | Reader question |
| --- | --- |
| `00-index.md` | Where should I start, and where is the task I need? |
| `01-overview.md` | What does this project do, and what are its limits? |
| `02-setup.md` | What do I need, and how do I get a working installation? |
| `03-configuration.md` | What can I configure, what are the defaults, and which value wins? |
| `04-architecture.md` | How do the components interact, and where does data go? |
| `05-workflows.md` | How do I perform the common tasks from start to finish? |
| `06-reference/` | What does each module, function, class, method, CLI, API, and schema do? |
| `07-operations.md` | How do I start, stop, deploy, upgrade, back up, and recover it? |
| `08-security.md` | How do identity, permissions, secrets, and trust boundaries work? |
| `09-troubleshooting.md` | How do I recognize, diagnose, and correct a failure? |
| `10-testing.md` | What checks exist, what do they establish, and how do I run them? |
| `11-contributing.md` | Where are the requirements, and how is a change implemented and checked? |
| `12-glossary.md` | What do the project's terms and abbreviations mean? |
| `evidence.md` | Which evidence supports the material, and what has been observed? |
| `coverage.md` | What has been reviewed and documented, and what remains? |
| `unknowns.md` | What cannot yet be established, why does it matter, and how is it resolved? |

Keep the index organized by reader task as well as chapter. Give newcomers a short reading path and maintainers a deeper path. Link to useful existing documents and canonical external references where they are actually required.

Prefer smaller reference pages grouped by cohesive component. Add a reference index so users do not need to know source filenames to find a capability. Show the relationship between a module's purpose and its symbols.

Use diagrams only when they clarify relationships, branching, or state. Use supported Mermaid syntax for component dependencies, trust boundaries, and data flows. Label uncertain relationships as uncertain in prose; do not draw them as established facts. Include a short textual explanation so the diagram is not the only source of information.

## 4. Document code and contracts

For each meaningful function, class, constructor, and method, establish the following from source and relevant evidence:

- Purpose and callers or consumers.
- Signature, visibility, synchronous or asynchronous behavior, and overloads.
- Parameters, types where known, required or optional status, defaults, accepted values, and validation.
- Return value, type where known, shape, sentinel values, and empty-result behavior.
- Errors, exceptions, rejection behavior, exit codes, and failure conditions.
- Side effects, state changes, persistence, I/O, resource ownership, and cleanup.
- Relevant concurrency, cancellation, ordering, idempotency, and performance constraints.
- One realistic example when it helps clarify correct use.
- Source references, limitations, and unresolved assumptions.

Do not assign a type or contract the implementation does not establish. For untyped parameters, describe observed use and uncertainty. Document inherited methods, generated APIs, aliases, and wrappers where a reader needs them; state how the inventory was obtained.

For classes, also explain construction requirements, instance lifecycle, public and internal responsibilities, invariants supported by code, and relationships with other types. For internal helpers, concise entries may be sufficient, but omission requires a stated scope decision.

For CLIs and services, include actual argument parsing, defaults, environment variables, files, outputs, exit behavior, and error paths. Do not assume command syntax from a dependency or an outdated README.

## 5. Run initial documentation

1. Capture the baseline and identify useful manual documentation.
2. Build the component map and a per-component review plan.
3. Inspect all eligible first-party files in bounded batches.
4. Resolve factual questions using the evidence workflow.
5. Draft task-based guides and reference material.
6. Publish new pages safely; propose changes to existing human pages.
7. Rescan after publishing to refresh the documentation-page inventory; confirm the source snapshot still matches the analysis. Record current reviews, claims, symbols, document mappings, and unknowns using that analysis baseline.
8. Check source freshness, document mappings, links, examples, and editorial consistency. Explicitly review all pages listed in `inventory.documents`, including generated pages.
9. Produce the index, coverage report, and unknowns report from the actual results; review these final pages too. Refresh the documentation inventory and affected records after their final edits.
10. Run the final strict mechanical check before claiming Complete. Interpret a normal integrity pass separately from coverage completeness, semantic accuracy, and editorial quality.

Do not modify source behavior to make it agree with a guide. If source contradicts a requirement, explain the observed behavior and record the discrepancy for implementation work.

## 6. Run maintenance

Follow [maintenance.md](maintenance.md). Rescan the entire declared scope, including new and deleted paths. Prioritize changed components and their dependents, then reconcile the broader inventory and coverage.

Use the previous ledger to find affected claims, pages, procedures, diagrams, and examples. A code change can invalidate a document outside the code's own directory. A dependency or configuration change can alter several operational guides without changing an exported function signature. Retire records for removed or replaced source explicitly after fixing or flagging their documentation, retaining the historical record and reason.

## 7. Checkpoint and finish

After each component batch, persist valid records and updated pages. Keep a brief checkpoint with the source snapshot, completed components, unresolved questions, pending components, and next exact action. Never record an entire batch as reviewed because only its entry point was read.

Finish with an explicit outcome and actual denominators. A clean mechanical check does not certify all semantics, all languages, or an unknown runtime environment. A finished run with evidence gaps must say so and explain each remaining action.

Do not make user-performed testing a required gate. Perform authorized checks available in the current environment. If a deployment, device, or runtime cannot be exercised, document what remains unverified, why it matters, and the steps that would establish it; finish accessible work with the appropriate outcome.
