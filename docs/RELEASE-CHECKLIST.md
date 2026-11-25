# Documenter 2 release checklist

Use this checklist to separate pack evidence, product checks, host qualification, and publication. A completed handoff pack is not a qualified product release.

## Identity and scope

- [ ] Record product version `2.0.0` and the exact source revision.
- [ ] Record handoff pack version `1.0.0` separately from product version.
- [ ] Record working-tree state and every artifact hash.
- [ ] State implemented core, optional adapters, and unsupported scope.
- [ ] Record the actual licence and third-party provenance decision. Do not invent one.

Generate a metadata skeleton from repository facts:

```bash
SOURCE_DATE_EPOCH="$(git show -s --format=%ct HEAD)" \
  node scripts/release-evidence.mjs --root . --output release-evidence.json
```

The generator records the Git revision, package hash, Node runtime, declared matrix gaps, and live-host gap. It does not run tests, load OMP, discover skills, exercise adapters, measure performance, or decide licensing. `SOURCE_DATE_EPOCH` makes `generatedAt` reproducible. Omit it when recording the generation time instead.

## Generate and inspect documentation

```bash
node scripts/generate-guide.mjs --root . --output docs/DOCUMENTATION-GUIDE.md
```

Confirm that the output contains these canonical sources in this order:

1. `README.md`
2. `docs/USER-GUIDE.md`
3. `docs/ARCHITECTURE.md`
4. `docs/ENGINE.md`
5. `docs/VALIDATION.md`
6. `docs/ROADMAP.md`

The guide generator validates all source files before writing. It writes one derived Markdown file, rewrites local links for the output location, and does not fetch remote content. It fails on a missing source, duplicate source, or output path that is also a source.

## Run implementation checks

Run the checks supported by the candidate and retain command, revision, runtime, exit status, and artifact paths:

```bash
node --test tests/*.test.mjs
node --check src/index.js
node --check lib/engine.mjs
node --check scripts/documenter.mjs
node --check scripts/generate-guide.mjs
node --check scripts/release-evidence.mjs
```

These commands establish only the checks that actually ran. A pack verifier establishes pack integrity, not product behavior. A mock OMP host is not a real OMP host qualification.

## Qualify the runtime and host

The declared product runtime is Node.js 22 or later. The release matrix requires exact patch versions for Node.js 22, 24, and 26. Record `passed`, `failed`, `not_run`, or `unsupported` for each row. Never convert an unavailable row into a pass.

| Row | Required checks | Observed state |
| --- | --- | --- |
| Node.js 22.23.5 | Product suite and affected integration checks | `passed` |
| Node.js 24.22.3 | Product suite, syntax, and benchmark checks | `passed` |
| Node.js 26.13.1 | Product suite and affected integration checks | `passed` |
| Real OMP host | Load, skill discovery, tool schema, read/write approval classification, and status/scan invocation | `partial` |

A live host run must name the OMP version and source revision. Record adapter versions only when observed. The v2 pack source reference `bf4a54ec5e1ae9ad6eb7a46c52a3ea059e24e329` is not proof that the installed host matches it.

## Verify lifecycle and readers

- [ ] Migrate v1 state with original hashes, archive verification, manual-edit preservation, and rollback manifest.
- [ ] Verify archive, staging, validation, promotion, interruption, resume, and restore.
- [ ] Verify destination relocation preserves `setId` and path mappings.
- [ ] Verify `frontpagePolicy` `none`, `root`, and `all` with exact path manifests.
- [ ] Verify saved Existing, usable Existing, Fresh, and explicit source-failure style paths.
- [ ] Run reader journeys with separate evidence for factual accuracy and usability.
- [ ] Record non-Markdown format limits, unknown languages, unsupported adapters, and open conflicts.

## Final disposition

Use one exact statement:

- **Implementation complete:** required implementation checks have evidence.
- **Complete with documented gaps:** accessible work is complete, with precise missing checks and impact.
- **Qualified release candidate:** the declared matrix and required gates passed for the identified artifact.
- **Published release:** an authorised publication succeeded and its destination was verified.

A local artifact can be ready while host qualification is unavailable. Publication is never inferred from passing tests or from a generated skeleton.
