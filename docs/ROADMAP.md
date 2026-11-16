# Roadmap

## Implemented foundation

The initial package combines a reusable OMP skill, explicit commands, automatic worker guidance, repository inventory, evidence records, coverage reporting, unknown tracking and protected whole-page publishing. Read [validation](VALIDATION.md) for actual test evidence and integration limits.

## Recommended next increments

| Priority | Addition | Benefit | Acceptance evidence |
| --- | --- | --- | --- |
| 1 | Real OMP host compatibility matrix | Establish loading and tool behavior on named OMP versions and providers. | Initial and maintenance fixtures run in real hosts, including worker fallback. |
| 2 | Language-aware symbol adapters | Give API coverage a meaningful denominator for supported languages. | Parser fixtures covering exported/private symbols, overloads, decorators, inheritance and dynamic limitations. |
| 3 | Explicit dependency and impact graph | Recheck changed interfaces and their dependents while retaining proven unaffected work. | Addition, deletion, config and dynamic-dependency fixtures; conservative fallback when graph completeness is unknown. |
| 4 | Baseline-preserving section merges | Update generated regions within human documents while preserving manual edits. | Three-way merge tests for insertions, moves, conflicts and interruption; no silent overwrite. |
| 5 | Documentation renderer adapters | Check navigation, anchors, diagrams and generated API pages using the project's real renderer. | Builds with existing MkDocs, Docusaurus, Sphinx or equivalent configuration, without forced migration. |
| 6 | Example-verification harness | Check executable examples in disposable, explicitly approved environments. | Recorded commands, output, exit codes, environment and revision; clear unexecuted cases. |
| 7 | Optional CI integrity job | Detect stale citations and scope changes in pull requests. | Fails for stale claims without silently rewriting records; respects repository CI policy. |
| 8 | Semantic search for very large repositories | Reduce repeated source retrieval where measured indexing cost is justified. | Benchmark token use, latency, missed context and index invalidation against the baseline. |

## Keep these properties

- Keep one discoverable command for each everyday workflow.
- Preserve useful human prose and explicitly identify conflicting evidence.
- Keep unavailable and excluded scope visible.
- Continue independent work when one fact cannot be verified.
- Keep a distinction between source inspection, execution evidence and recommendations.
- Treat all model routing and worker-count choices as configurable.
- Prefer measurable improvements over new infrastructure without a demonstrated need.
