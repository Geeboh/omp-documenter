# OMP Documenter

**Create and maintain repository documentation that describes the code you actually have.**

OMP Documenter is an Oh My Pi extension package with an agent skill and a deterministic integrity engine. The agent investigates the repository and writes the explanation. The engine inventories files, checks evidence locations and hashes, tracks coverage, and protects existing documentation when pages are published.

Documentation must be clear, consistent and user friendly. Every factual explanation must have sufficient evidence. Unknown facts remain visible, with their impact and a practical way to resolve them.

## Start here

1. Install or unpack this package into a permanent directory outside the repository you want to document.
2. Link it to OMP:

   ```bash
   omp plugin link /absolute/path/to/omp-documenter
   ```

3. Start a new OMP session in the root of the repository you want to document:

   ```bash
   cd /path/to/your/project
   omp
   ```

4. Run the initial documentation workflow:

   ```text
   /documenter initial
   ```

5. After code changes, run the maintenance workflow:

   ```text
   /documenter maintain
   ```

The directory passed to `plugin link` must remain available. For a single session, load the package directory with `omp --extension /absolute/path/to/omp-documenter` instead.

## What is included

| Part | Purpose |
| --- | --- |
| OMP command `/documenter` | Start initial documentation or maintenance; show status; run mechanical checks. |
| OMP tool `documenter_state` | Give the agent a consistent interface for inventory, records, coverage and safe publication. |
| Skill `omp-documenter` | Define evidence standards, investigation, parallel review, documentation structure and editorial quality. |
| Standalone CLI | Run the same integrity engine without a model or OMP session. |
| Repository state | Keep hashes, coverage, findings, unknowns, page ownership and update journals in `.documenter/`. |
| Tests | Exercise preservation, evidence validation, freshness, repository boundaries and command integration. |

## Everyday commands

| Command in OMP | Result |
| --- | --- |
| `/documenter initial` | Inventory the repository, investigate components, fill missing documentation and report remaining gaps. |
| `/documenter maintain` | Compare the current repository with previous evidence, update safe-to-replace pages, preserve edited content and flag uncertainty. |
| `/documenter status` | Recheck live files and show current coverage and attention items without changing state. |
| `/documenter check` | Check mechanical integrity, stale records, page changes and supported local links. |
| `/documenter check --strict` | Also require the defined scope to have current review and documentation coverage with no unresolved gaps. |

Parallel component reviews default to **automatic, with up to three workers plus the coordinator**, where OMP exposes worker tools. The coordinator owns the final documentation and state. If workers are unavailable, the same workflow runs sequentially.

## Read next

- [User guide](docs/USER-GUIDE.md): installation, initial runs, maintenance, configuration and recovery.
- [Architecture and recommendations](docs/ARCHITECTURE.md): responsibilities, evidence model, parallel work and tradeoffs.
- [Engine reference](docs/ENGINE.md): exact CLI and JSON contracts.
- [Validation and limits](docs/VALIDATION.md): what has been checked and what needs a real OMP host.
- [Roadmap](docs/ROADMAP.md): useful next improvements, in priority order.
- [Agent skill](skills/omp-documenter/SKILL.md): the instructions OMP follows.

## Compatibility

The OMP adapter follows upstream interfaces checked on **16 November 2026**. It uses `registerCommand`, `registerTool`, `pi.zod`, `sendUserMessage` and the `omp.extensions` package manifest. The standalone engine requires **Node.js 20 or later** and has no third-party runtime dependencies. Git is used when available; a filesystem inventory supports non-Git folders.

OMP host integration must be verified against the installed OMP version. Tests with a mock host establish adapter behavior, not real OMP loading or provider compatibility. See [validation](docs/VALIDATION.md) for the precise evidence.

## What a passing check means

A passing mechanical check means the implemented integrity conditions passed. It does **not** establish that an agent interpreted every function correctly, that every language symbol was discovered, that an example was executed, or that the project is secure. Those distinctions must remain visible in the generated documentation.
