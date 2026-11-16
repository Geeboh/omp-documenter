# Maintain an existing documentation library

## Contents

1. Preserve useful content
2. Maintenance procedure
3. Safe publishing
4. Human and mixed pages
5. Contradictions and removed features
6. Retire obsolete records explicitly
7. Resume efficiently

## Preserve useful content

Treat existing documentation as an asset. Keep accurate explanation, operator experience, rationale, terminology, examples, and navigation. Correct obsolete facts without erasing useful context.

Distinguish source-verified behavior from human-authored intent or operational knowledge. If the source cannot verify a manual statement, preserve it and flag the limitation in a companion note or proposed revision. Do not delete it merely because it is not represented in code.

The first version uses whole-file ownership. It can replace a page only when Documenter previously wrote it and the current bytes still match its ownership record. A manually edited generated page becomes protected; it is not silently merged or reclaimed.

## Maintenance procedure

1. Run a fresh scan across the complete declared scope.
2. Compare added, changed, and deleted paths with the previous inventory.
3. Read affected source, callers, configuration, tests, schemas, and dependencies.
4. Find all claims and pages depending on that behavior, including diagrams, examples, setup steps, and troubleshooting entries.
5. Check for new components or required topics that have no document mapping.
6. Classify each affected statement as still supported, changed, stale, unknown, or conflicting.
7. Draft the smallest coherent update that restores accuracy and clarity.
8. Check that the live source snapshot still matches the analysis. Publish unchanged plugin-owned pages through the helper. Preserve protected pages and create a proposal or companion page.
9. Rescan after publishing to refresh documentation-page hashes and reconfirm the source baseline. Re-record reviewed source, pages, and claims only after actual investigation, retaining that analysis baseline in required `expectedSnapshot`.
10. Retire obsolete reviews and claims after correcting or visibly flagging affected documentation. Preserve their history and give a specific reason.
11. Recheck evidence freshness, links, document mappings, topic coverage, and editorial consistency. Run the final strict mechanical check before claiming Complete.

A renamed file may appear as a deletion and addition. Investigate whether the component moved, changed, or disappeared before deleting explanations. A signature that remains unchanged can still have different side effects or failure behavior.

## Safe publishing

For a new page, publish with `expectedSha256: null`. For an existing plugin-owned page, use its current exact SHA-256 as `expectedSha256`.

```json
{
  "path": "docs/documenter/04-architecture.md",
  "content": "# Architecture\n\nReplace with the complete reviewed page.\n",
  "expectedSha256": null
}
```

This example is for a new page only. Never send `null` to force replacement of an existing page. The helper verifies both the supplied expectation and its prior ownership record.

If replacement is refused:

1. Read the conflict reason and proposal location.
2. Confirm that the existing page is preserved.
3. Compare the existing page and proposed revision.
4. Continue independent documentation work.
5. Report the conflict with the proposed change and why it is needed.

Do not bypass the guard using a direct write, delete-and-create operation, changed output path that disguises the same page, or ownership metadata edit. When a companion page is appropriate, give it a clear purpose and link to the preserved source. Do not create competing "canonical" guides with contradictory instructions.

## Human and mixed pages

Use a proposal for a preexisting or edited page. Explain which passages need revision, the evidence for the revision, and which useful passages should remain. A proposal can be reviewed without applying it to the original.

A user may later authorize a specific manual edit or merge. Apply that authorization through an appropriate editing workflow; do not pretend that Documenter's whole-file ownership model supports automatic three-way merging or managed blocks. Once manually edited, the page remains protected unless a future explicit adoption workflow is implemented.

Keep a clear status for unresolved proposals. A successful proposal write is not a successful update to the target page. Flag stale text that remains in the preserved page so readers do not mistake it for newly verified guidance.

## Contradictions and removed features

When source, tests, and documentation disagree, show the disagreement precisely. Describe the current implementation, the test expectation, and the manual statement with their respective evidence. Do not choose whichever interpretation is easiest to document.

For a removed feature, check whether compatibility code, migration paths, or historical documentation still needs it. Update active guidance only when the removal is established. Preserve historical notes when they remain useful, clearly labeled with their version or scope.

For changed security or recovery behavior, prioritize the affected guidance. Do not claim a safety property or a recovery capability merely because it existed in an earlier revision.

## Retire obsolete records explicitly

Deleted or renamed source can leave old reviews and claims stale. After updating the affected pages or clearly flagging the outstanding change, use the record operation's retirement fields. They are optional arrays in the same payload as the required current analysis `expectedSnapshot`:

```json
{
  "expectedSnapshot": "REPLACE_WITH_THE_ANALYSIS_SNAPSHOT_64_HEX_DIGITS",
  "retireReviews": [
    {
      "path": "src/old-module.js",
      "reason": "The module was removed; the reference and architecture pages now describe its replacement."
    }
  ],
  "retireClaims": [
    {
      "id": "C-OLD-MODULE-001",
      "reason": "The removed entry point no longer exists; its active guidance has been replaced and the new behavior has a separate current claim."
    }
  ]
}
```

This is a schema example; replace every path, identifier, reason, and snapshot with inspected facts. The helper retains each full original record in `ledger.retired` with its reason and retirement time. Repeating an already completed retirement is harmless; an identifier that was never recorded or retired is an error.

Record replacements for renamed files or changed contracts separately. Retiring a review of a current file lowers coverage until a new review is recorded. Do not retire an uncertain or conflicting current claim merely to make checking pass. Resolve or visibly qualify the actual documentation, preserve the uncertainty when it still applies, and report the resulting state honestly.

Retirement changes ledger records; it does not delete source files, remove documentation pages, or relinquish ownership of an edited generated page. Protected pages still require the proposal or deliberate editing workflow described above.

## Resume efficiently

Use current state to avoid repeating completed work unnecessarily. Conservative freshness invalidation still requires a real review before refreshing a record. Reuse explanations that remain correct, and focus investigation on behavior affected by the change and its dependencies.

End with the actual pages changed, protected pages, pending proposals, stale claims, unresolved questions, and current coverage. If all accessible work is finished but protected material needs a decision, use **complete with gaps** and make the proposal concrete.
