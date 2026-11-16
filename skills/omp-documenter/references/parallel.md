# Parallel repository review

## Use parallel workers by default when useful

With `parallel.mode: "auto"`, use up to `parallel.maxWorkers` review workers when the host exposes a suitable task or subagent capability and at least two separable units of work exist. The default is three workers plus the coordinating agent. Respect the host's actual concurrency limit and any lower user budget or worker limit.

Use the current model and the host's established routing by default. Do not hard-code a model, invent a worker flag, or start a larger model merely because parallel work is available. Small repositories, tightly coupled investigations, and unavailable workers should run sequentially without becoming blocked.

The deterministic helper does not spawn workers. These settings guide the agent's orchestration. No `/vibe` mode is required.

## Inspect the available task interface

Discover and read the actual host tool schema before dispatch. OMP task tools can expose a batch form or an individual-task form, and their fields depend on host settings. Do not paste an assumed task payload or depend on an unverified flag.

Use only capabilities available in the current session. If dispatch is unavailable or fails because of capability limits, continue sequentially. Do not spend repeated attempts trying to enable concurrency during a documentation task.

## Divide responsibilities clearly

Partition by cohesive components or independent reader topics, not arbitrary equal-sized file chunks. Examples include a CLI component, a persistence component, and a web interface after the coordinator has established their shared contracts.

Assign each source file to one primary reviewer. Permit a worker to read dependencies needed to understand its component, but keep responsibility for final claims and pages explicit. Reserve cross-component architecture, integration behavior, terminology, and the final index for the coordinator.

Prefer a bounded batch of workers. Do not let workers recursively create more workers. Avoid concurrent workers investigating the same unknown unless a deliberate independent second assessment is needed.

## Supply a compact, sufficient brief

Give each worker:

- The selected repository root and its exact source snapshot.
- Assigned files or component boundaries and relevant current hashes.
- The specific reader questions or contracts to establish.
- The governing evidence rule and required uncertainty labels.
- The relevant writing standard and canonical terminology.
- The exact output contract and a distinct scratch destination, if a file is needed.
- The instruction to read source without changing it, public documentation, or shared Documenter state.

Provide only context needed for the assigned work. Do not send the full repository, the entire conversation, or every reference chapter when a focused component brief is sufficient. Preserve the important shared assumptions explicitly so context savings do not introduce inconsistent interpretations.

## Require structured results

Each worker returns:

1. The analysis baseline as `expectedSnapshot` and actual paths inspected.
2. Meaningful file review summaries and current hashes.
3. Declared symbols, signatures, inputs, outputs, errors, and side effects that were established.
4. Claims with status, exact evidence ranges, source hashes, and proposed document mappings.
5. Unknowns or conflicts, including their importance and concrete resolution steps.
6. Draft pages or proposed changes following the common writing standard.
7. Cross-component assumptions and interfaces that the coordinator must reconcile.
8. Verification actually performed and its limits.

Namespace worker claim and unknown identifiers by component, such as `C-CLI-001` and `U-STORAGE-001`. The coordinator resolves collisions before recording them.

Workers may return findings directly or write only to their assigned scratch locations. They must not call `record` or `publish`, edit ownership files, change source, or write the public documentation library. This keeps shared state and final prose under one coordinator.

## Integrate results carefully

Wait for each worker's actual completion. A task acceptance or spawn acknowledgment is not a completed review. Inspect the returned evidence and draft; do not automatically accept a worker's coverage or correctness claim.

Before integration:

1. Check that the worker's `expectedSnapshot` and file hashes match the intended analysis baseline and live source.
2. Reject stale findings if source changed during the review; reassign affected work. Never replace an old snapshot in a worker result merely to make it current.
3. Verify that cited ranges support the stated claims, especially security and operational assertions.
4. Reconcile shared interfaces, data flows, configuration precedence, terminology, examples, and contradictions.
5. Remove duplicate explanations and choose canonical links.
6. Recheck the live source snapshot before publishing final pages. Publish and record validated results serially through the helper; include the unchanged analysis `expectedSnapshot` in every record payload.
7. Perform the final cross-library semantic and editorial review.

Parallel review increases throughput; it does not remove the coordinator's responsibility to understand how the components work together. Report the actual completed work and any failed or incomplete worker tasks in the final coverage result.
