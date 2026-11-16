# Coverage and completion

## Contents

1. Keep four separate measures
2. Define the scope
3. Record file reviews
4. Review documentation pages separately
5. Be honest about symbols
6. Track topics and components as well as files
7. Handle freshness
8. Interpret checks
9. Finish with an accurate outcome

## Keep four separate measures

| Measure | Meaning | What does not count |
| --- | --- | --- |
| Inventoried | A path or boundary was discovered and classified | Understanding its behavior |
| Reviewed | The current content was inspected and a meaningful review was recorded | Seeing its filename, scanning a header, or reading only a caller |
| Documented | Current reviewed behavior is mapped to useful extant pages and supported claims | An empty page or an unrelated link |
| Evidence current | The recorded source references still match the current inputs | Proof that the explanation is semantically correct |

Report counts and denominators alongside percentages. Keep exclusions, boundary gaps, unreadable inputs, and unknowns visible. Do not reduce the denominator simply to improve the result.

## Define the scope

The default target is all eligible first-party content inside the selected repository root, including nested modules and locally available nested Git repositories or checked-out submodules. Git discovery can omit ignored files; the report must state that boundary. Explicitly account for vendored dependencies, generated files, binary assets, secrets, unavailable submodules, and external systems.

If material is excluded, give its path or category, reason, and effect. An exclusion is a scope decision, not a review. An unavailable submodule is a gap unless the declared documentation scope explicitly excludes it for a legitimate reason.

Use separate results for separate repository roots. If a monorepo has component reports, list them and explain which root-level architecture and integration claims connect them.

## Record file reviews

After reading a file and its necessary context, submit a review using its current inventory hash and the required `expectedSnapshot` from the scan used for that review:

```json
{
  "expectedSnapshot": "REPLACE_WITH_THE_ANALYSIS_SNAPSHOT_64_HEX_DIGITS",
  "reviews": [
    {
      "path": "src/example.js",
      "sha256": "REPLACE_WITH_THE_CURRENT_64_HEX_DIGIT_HASH",
      "summary": "Replace this with the concrete responsibilities and relevant behavior actually inspected.",
      "documents": ["docs/documenter/06-reference/example.md"],
      "symbols": [
        {
          "name": "exampleFunction",
          "kind": "function",
          "signature": "Replace with the actual signature",
          "doc": "docs/documenter/06-reference/example.md",
          "notes": "State any genuine limitations of this symbol record."
        }
      ]
    }
  ]
}
```

This is an authoring example. Do not submit it with placeholders. Associate claims with the relevant current source and document paths. Publish referenced pages before recording them when the helper requires them to exist.

Do not turn "reviewed" into a box-ticking exercise. A meaningful summary should distinguish the file's purpose, its interfaces, its relationship to other components, and any important uncertainty.

## Review documentation pages separately

`inventory.documents` lists Markdown pages under the configured output root separately from source entries in `inventory.files`. Read every such page for factual accuracy, clarity, consistency, usable examples, and navigation. Publishing a generated page does not automatically mark it reviewed.

Run `scan` after publishing to refresh the persisted page inventory, then confirm its source snapshot still matches the analysis. `status` and `check` inspect live content but do not rewrite `.documenter/inventory.json`; a previously saved inventory might not contain a newly published page or its latest hash.

After editorial and factual inspection, record a normal review with the page's current hash, a substantive review summary, and empty `documents` and `symbols` arrays. Include the analysis baseline as the payload's required `expectedSnapshot`. The page itself is the object being reviewed; it does not need to point to a second page merely to qualify for review.

Status reports this work in `coverage.documentationPages` and `attention.unreviewedDocumentation` or `attention.documentationGaps`. Strict checking requires the documentation-page review as well as source coverage and current claims. Changes to a page invalidate its page review even though output-page changes do not alter the source snapshot.

## Be honest about symbols

The built-in ledger accepts declared symbol records; it does not prove that every symbol in every language has been found. Report symbol counts as **declared symbols**, with completeness **not exhaustive unless separately established**.

To establish stronger coverage, use an appropriate parser, language service, generated API schema, or a complete manual enumeration suitable for that language. Record the method and its limitations in the coverage report. Still inspect wrappers, overloads, dynamic members, generated interfaces, and private helpers that matter to maintenance.

Cover functions, classes, constructors, methods, and other meaningful interfaces. Public APIs usually need the most detailed examples, but the user's repository-wide request includes internal code. Do not silently equate "public API documented" with "entire codebase documented."

## Track topics and components as well as files

File coverage cannot establish that the library explains the system. Maintain a topic matrix covering setup, configuration, architecture, workflows, code reference, operations, security, troubleshooting, testing, contribution, glossary, and evidence.

For each component, list its source paths, review state, documentation pages, material claims, dependencies, and unresolved questions. For each required topic, use one of: complete with evidence, partial, missing, not applicable with reason, or unknown with resolution steps.

This topic matrix is an agent-authored report. Do not imply the helper automatically checks its semantic completeness.

## Handle freshness

Read current status before finishing. Source changes, new files, deleted files, modified documentation, and changed scope can invalidate earlier records. The helper conservatively makes all reviews and claims stale after any source snapshot change, including documentation-page reviews, even when a particular file's bytes did not change.

Re-review affected behavior and record a current assessment. Reuse prior findings for unchanged content only after revalidating relevant dependencies and component relationships. Do not replace `expectedSnapshot`, hashes, or snapshot identifiers merely to make the check pass. New files require investigation; deleted files require checking obsolete references, entry points, diagrams, and procedures.

Keep previous evidence available for comparison, but label stale evidence. A historical claim can remain useful when it is explicitly tied to a historical revision.

After a source deletion or rename, correct or flag the affected documentation and explicitly retire the old review or obsolete claim. Use `retireReviews: [{"path": "old/path", "reason": "Specific explanation"}]` or `retireClaims: [{"id": "C-OLD-001", "reason": "Specific explanation"}]` in a `record` payload with the current analysis `expectedSnapshot`. The originals remain in `ledger.retired` with reasons and timestamps. Register any replacement path or claim separately. Never retire records solely to hide incomplete coverage; retiring a current source review makes that file unreviewed until it is reviewed again.

## Interpret checks

`check` reports mechanical integrity and freshness. A normal check can pass while eligible files remain unreviewed or undocumented, pages await editorial review, or open unknowns remain. Its `integrity` and `complete` fields answer different questions.

Run `check` with `strict: true`, or `/documenter check --strict`, before claiming Complete. Strict checking additionally requires nonempty eligible source scope, all eligible source files reviewed and documented, all output pages reviewed, no source or documentation inspection gaps, no open unknowns, and at least one current supported claim. Normal integrity also rejects stale records, changed or missing owned pages, detected local link failures, and current unknown or conflicting claims. Explicit exclusions remain disclosed rather than counted as reviewed.

The link check covers local inline Markdown links and common heading or explicit HTML anchors. Reference-style links, nested link destinations, site-root URLs, remote URLs, and renderer-specific behavior require a separate review or appropriate renderer. Inspect the reported scope and skipped cases; do not call all links verified when only this subset was checked.

An agent still must evaluate whether evidence actually supports claims, whether the symbol inventory is adequate, whether examples are usable, and whether the prose meets the writing standard. No mechanical result authorizes a claim of universal correctness.

A strict failure is informative when the remaining gap cannot be resolved in the current environment. Record the cause and finish with **complete with gaps** when all accessible work is done. Do not turn unavailable runtime checks into mandatory manual user tests or change scope merely to force a pass.

## Finish with an accurate outcome

Use the outcome definitions in the core skill. For **complete with gaps**, list each remaining gap and its effect rather than hiding it behind a success label. For a checkpoint, record the exact pending component and next investigation so a later run can resume without repeating the entire review.

A useful final report includes:

- Selected root, mode, source snapshot, and discovery method.
- Eligible paths and separate exclusion or boundary counts.
- Current reviewed and documented counts with denominators.
- Separately reviewed documentation pages and remaining editorial work.
- Declared symbol count and inventory method.
- Current supported claims, stale claims, inferences, conflicts, and unknowns.
- Pages created, updated, preserved, and proposed.
- Mechanical checks, semantic review, and editorial review actually completed.
- Remaining steps and the exact continuation command when appropriate.
