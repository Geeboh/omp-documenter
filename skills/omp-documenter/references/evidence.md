# Evidence and uncertainty

## Contents

1. Evidence categories
2. Establish a claim
3. Investigate an unknown
4. Record claims
5. Use source references
6. Document examples and verification

## 1. Evidence categories

Treat evidence according to what it can establish. No single category automatically outranks all others for every question.

| Evidence | What it can establish | What it cannot establish by itself |
| --- | --- | --- |
| Current implementation | The behavior encoded along an inspected path | That every environment executes that path, or that the behavior is correct |
| Types, schemas, and validators | Declared shapes and implemented validation | Every runtime value or every integration's compliance |
| Current configuration and manifests | Declared defaults, dependency constraints, and configured entry points | Actual production values or deployed versions |
| Test source | Intended assertions and covered scenarios | That the test passed in this run |
| Observed test or command result | The result for the recorded command, inputs, revision, and environment | Universal correctness or untested scenarios |
| Existing human documentation | Useful explanation, intent, operational knowledge, and historical context | Current implementation behavior without corroboration |
| Comments, names, and commit messages | Clues, intent, and search leads | Proof of behavior |
| Authoritative external documentation | A dependency's documented contract for the relevant version | That this repository uses the dependency in that way |
| User-provided operational evidence | The recorded behavior in the stated environment | Behavior outside that environment or a result not actually supplied |

Preserve manual knowledge that source code cannot express, such as why a deployment was chosen. Attribute it as documented intent or operator guidance. Do not mislabel it as source-verified behavior.

## 2. Establish a claim

For every material behavioral assertion, answer these questions:

1. What exactly is being claimed?
2. Which current implementation path establishes it?
3. What input, configuration, version, or environment limits the claim?
4. Which caller, test, validator, or integration confirms the interpretation?
5. What alternate or failure path could make the wording misleading?

Trace the path far enough to establish the claim. Reading a function named `validateToken` does not establish which tokens it accepts, whether it runs on every route, or whether rejection prevents a side effect.

Prefer narrow, testable wording. For example, "The handler rejects a missing token before calling the storage adapter" is more defensible than "The service is secure." Security guarantees need substantially stronger evidence than the presence of authentication code.

Classify the result:

| Status | Meaning | Required wording |
| --- | --- | --- |
| `supported` | Current evidence supports the specific, bounded claim | State the behavior and its conditions; cite the evidence |
| `inference` | Evidence suggests a conclusion but does not establish it | Label it as an inference and explain the missing link |
| `unknown` | Available evidence is insufficient | State what is unknown, its impact, and how to establish it |
| `conflict` | Reliable sources disagree or intended and implemented behavior diverge | Describe both sides, their evidence, and what resolves the discrepancy |

Do not use numeric confidence scores to make unsupported claims appear precise.

## 3. Investigate an unknown

Use up to three targeted attempts per unresolved question, stopping earlier if no new evidence is available:

1. Follow direct code: implementation, callers, configuration precedence, validation, and error handling.
2. Inspect corroborating material: relevant tests, fixtures, schemas, generated sources, deployment definitions, and dependency version constraints.
3. Use an appropriate remaining source: authoritative version-matched documentation, authorized isolated execution, or a focused question whose answer cannot be obtained locally.

Choose attempts based on the question rather than mechanically executing all three. Do not run production or destructive operations to fill a documentation gap. Do not install packages or fetch unavailable repositories without existing authorization.

When unresolved, record:

- A stable identifier, such as `U-RECOVERY-001`.
- The precise unanswered question.
- What was inspected and what it did or did not establish.
- Why the uncertainty matters to a reader or operator.
- A concrete resolution procedure and required access or input.
- Affected pages and any claim that must remain qualified.

Continue work that does not depend on the unknown. Ask the user only when an answer is needed to proceed with necessary work, and finish independent work first.

## 4. Record claims

Use `record` after publishing the referenced pages. Include the required `expectedSnapshot` from the scan used for the analysis. Obtain each `sha256` from that inventory; do not type a guessed value. The helper rejects a record if any in-scope source changed after the analysis baseline. The following is a schema example, not a ready-to-submit record:

```json
{
  "expectedSnapshot": "REPLACE_WITH_THE_ANALYSIS_SNAPSHOT_64_HEX_DIGITS",
  "claims": [
    {
      "id": "C-CONFIG-001",
      "text": "The loader uses the configured cache directory when that option is present.",
      "status": "supported",
      "evidence": [
        {
          "path": "src/config.js",
          "sha256": "REPLACE_WITH_THE_CURRENT_64_HEX_DIGIT_HASH",
          "startLine": 14,
          "endLine": 28
        }
      ],
      "documents": ["docs/documenter/03-configuration.md"]
    }
  ]
}
```

Replace the illustrative path, lines, wording, document, snapshot, and hash with inspected facts. Supported claims require real evidence. Use positive line ranges for nonempty files; `startLine: 0` and `endLine: 0` are valid only for an actual zero-byte file. For every inference, unknown, or conflict, supply both `reason` and `resolution` as nonempty strings describing the limitation and how to resolve it.

Use separate `unknowns` entries for actionable unresolved work:

```json
{
  "expectedSnapshot": "REPLACE_WITH_THE_ANALYSIS_SNAPSHOT_64_HEX_DIGITS",
  "unknowns": [
    {
      "id": "U-RECOVERY-001",
      "question": "Can this deployment restore its persistent volume from the documented backup?",
      "whyItMatters": "Operators cannot rely on the recovery procedure without a compatible restore result.",
      "nextSteps": [
        "Identify the deployed volume and backup format.",
        "Perform an authorized restore into an isolated environment.",
        "Record the command, versions, observed checks, and result."
      ],
      "status": "open"
    }
  ]
}
```

Only close an unknown after the missing evidence is established. Record the resolution; changing its status alone is not evidence. Avoid creating one claim for every trivial sentence, but record all consequential behavior, defaults, commands, requirements, security properties, and operational assertions. A page with no meaningful claims must not count as verified merely because its file exists.

If a claim no longer applies because its source or behavior was removed or replaced, first update or visibly qualify the affected documentation. Then retire it using `retireClaims` with its exact `id` and a substantive `reason`. The ledger archives the original record in `retired`; retirement is not deletion of the historical evidence and is not a way to conceal an unresolved current claim. Read [maintenance.md](maintenance.md) for the complete lifecycle.

## 5. Use source references

Attach compact source references near the behavior they support. Give a repository-relative path, symbol or configuration key, and relevant line range. In the evidence ledger, retain the exact content hash and current snapshot. When an immutable repository URL is available, it can supplement the local reference.

Lines are navigation aids, not stable identities. A changed file invalidates its prior evidence even when the cited line numbers still exist. Do not preserve a claim's "supported" appearance by moving its line range without reviewing the new content.

For claims involving multiple files, cite all material links in the chain. For an architectural relationship, cite the actual caller and callee or interface binding. For configuration precedence, cite the merge or resolution implementation and its relevant defaults.

Never copy secret values, private keys, access tokens, customer data, or credentials into the ledger. Source names and configuration keys are usually sufficient. Use sanitized outputs only when the transformation and its limits are clear.

## 6. Document examples and verification

Label examples according to their evidence:

- **Observed:** executed in the recorded environment with the recorded result.
- **Source-derived:** built from actual argument parsing, types, validators, or configuration, but not executed in this run.
- **Illustrative:** demonstrates a concept and requires adaptation; do not present its output as observed.

For observed checks, record the source revision or snapshot, working directory, exact command and arguments, relevant environment without secrets, exit result, and a concise result summary. If a test was not run, say "not run" and explain the reason when it matters.

A passing suite establishes that the executed assertions passed. It does not establish that every documented sentence is true. The agent must still review the connection between each material claim and its evidence.
