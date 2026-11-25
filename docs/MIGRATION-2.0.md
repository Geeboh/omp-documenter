# Migrate and recover Documenter 2

Documenter v1 targeted Node.js 20. Documenter v2 targets Node.js 22 or later. Release qualification must run exact patch versions on Node.js 22, 24, and 26. A v1 record is never silently rewritten as v2 state.

## Prepare a migration

1. Work from a clean, inspectable source state. Preserve unrelated user changes.
2. Record exact hashes for the v1 configuration, inventory, ledger, ownership, proposals, and journals.
3. Inspect incomplete v1 journals. Distinguish committed updates from interrupted writes.
4. Prepare v2 candidates under `.documenter/migrations/MIGRATION_ID/` while v1 remains readable.
5. Archive the selected v1 bytes and verify the archive manifest.
6. Map `docsRoot` to the default set destination. Preserve the set identity and old-to-new path mappings.
7. Map ownership, current page bytes, claims, reviews, unknowns, retirement history, and proposal status separately.
8. Mark imported assessments `legacy-unrevalidated` until their evidence and context are checked again.
9. Commit the v2 configuration, set registry, generation indexes, and rollback manifest through the migration journal.

Read-only inspection never migrates state. A write must use the supported journalled transition. A malformed or corrupt record becomes an explicit migration gap. It is not discarded to make migration pass.

The v2 state uses `schemaVersion: 2`. The original v1 records remain in the migration archive with `schemaVersion: 1`. Unsupported future versions fail with an actionable message.

## Recover an interrupted run

Use the v2 contract commands from the repository root:

```text
/documenter doctor
/documenter resume RUN_ID
/documenter archives
/documenter restore ARCHIVE_ID
```

`doctor` reports lock evidence and incomplete operations. It does not remove a lock automatically. `resume` derives its destination from the immutable run manifest, reconciles the journal with current bytes, and rechecks guards before each transition. `restore` creates a new restoration run. It does not erase the run that produced the current generation.

Before resuming, inspect the run manifest, events, staged files, validation receipt, journal, and current page hashes. Preserve a newer human edit when the expected hash no longer matches. Resolve the conflict through the ownership workflow.

Do not use these recovery shortcuts:

```bash
git reset --hard
git clean -fd
rm -rf .documenter
```

Those commands destroy evidence, user edits, or recovery state. Use the journal and archive instead.

## Durability limits

Documenter uses temporary files, synchronization where supported, and atomic replacement for individual files. A generation spans multiple files, so one atomic JSON replacement does not make publication a single filesystem transaction. A crash can leave a prepared journal or a split state. Recovery must classify observed bytes before applying a repair.

The writer lock coordinates cooperating Documenter writers. It does not stop an external editor. Revalidate source, document, style, and ownership hashes after reacquiring the lock. External destinations remain unsupported in the core release. Non-Markdown assets are preserved and reported; they are not silently converted.
