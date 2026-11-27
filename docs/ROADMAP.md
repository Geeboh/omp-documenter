# Roadmap

## Implemented foundation

The initial package combines a reusable OMP skill, explicit commands, automatic worker guidance, repository inventory, evidence records, coverage reporting, unknown tracking and protected whole-page publishing. Read [validation](VALIDATION.md) for actual test evidence and integration limits.

## Completed roadmap increments

The following increments are implemented in the current worktree. Each remains bounded by its recorded capability limits.

| Priority | Addition | Status | Benefit | Acceptance evidence |
| --- | --- | --- | --- | --- |
| 1 | Real OMP host compatibility matrix | Complete | Probe named OMP versions and isolated extension loading without shell interpretation. | `scripts/omp-host-matrix.mjs`, live OMP 19.2.1 matrix receipt, host-wrapper tests. |
| 2 | Language-aware symbol adapters | Complete with limits | Report stable JavaScript/TypeScript and Python declaration metadata. | Symbol tests cover exports, private names, decorators, inheritance and overload-like declarations. |
| 3 | Explicit dependency and impact graph | Complete with conservative fallback | Recheck changed interfaces and dependents while exposing unknown dynamic/configuration edges. | Dependency graph tests cover interface edges, changes, config records and all-files fallback. |
| 4 | Baseline-preserving section merges | Complete with limits | Merge non-overlapping generated sections while preserving current content on conflicts and interruption. | Merge tests cover anchors, moves, insertions, conflicts and interruption. |
| 5 | Documentation renderer adapters | Complete with inspection-only execution | Detect MkDocs, Docusaurus and Sphinx configuration without claiming a renderer build. | Renderer adapter tests and `scripts/renderer-check.mjs`. |
| 6 | Example-verification harness | Complete with limits | Execute explicit argv examples with bounded output, environment and revision receipts. | Verification tests and `.github/fixtures/documenter-examples.json`. |
| 7 | Optional CI integrity job | Complete | Run examples, renderer detection, host probing, tests and syntax checks in CI with evidence artifacts. | `.github/workflows/ci.yml` `integrity` job. |
| 8 | Semantic search for very large repositories | Complete as measured lexical index | Reuse content-addressed lexical indexes and report invalidation; no unmeasured embeddings. | Synthetic baseline plus `psf/requests` overlap versus `weighted-v1` lexical comparison. |

## Long-distance deferred scope

Full documentation-site creation, theme selection and hosted renderer integration are deferred. Current projects primarily publish GitHub-rendered Markdown with images, local links and source references.

Documenter will not force MkDocs, Docusaurus, Sphinx or another site generator into those projects. Renderer detection remains available for projects that already declare one.

Reopen this scope only when a project supplies a site requirement, renderer configuration, build command, navigation policy and an authorized visual validation target.

## Keep these properties

- Keep one discoverable command for each everyday workflow.
- Preserve useful human prose and explicitly identify conflicting evidence.
- Keep unavailable and excluded scope visible.
- Continue independent work when one fact cannot be verified.
- Keep a distinction between source inspection, execution evidence and recommendations.
- Treat all model routing and worker-count choices as configurable.
- Prefer measurable improvements over new infrastructure without a demonstrated need.
