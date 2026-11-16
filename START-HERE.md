# OMP Documenter 1.0.0 — ZIP installation

This ZIP contains the complete, ready-to-link OMP plugin, its source, skill,
references, templates, tests and documentation. The plugin behavior is unchanged
from the previously supplied 1.0.0 release.

## Install the extracted package

1. Extract the ZIP into a permanent location. Keep the top-level
   `omp-documenter-1.0.0` directory together. Use a new directory to preserve any
   existing installation or edits.
2. Link that extracted directory to your existing OMP installation:

   ```bash
   omp plugin link /absolute/path/to/omp-documenter-1.0.0
   ```

   Replace the example path with the actual extracted directory. Keep this
   directory available because OMP links to it.
3. Start a new OMP session from the repository you want to document:

   ```bash
   cd /path/to/your/project
   omp
   ```

4. Inside OMP, run:

   ```text
   /documenter initial
   ```

For later updates, run `/documenter maintain`. Use `/documenter status` to see
coverage and `/documenter check` to inspect recorded integrity.

No npm installation is required. Node.js 20 or later is needed for the standalone
CLI and package tests. OMP host integration limits are explained in
[validation](docs/VALIDATION.md).

## Read more

- [README](README.md): quick introduction and commands.
- [Complete guide](OMP-Documenter-1.0.0-Guide.md): instructions, architecture,
  configuration, engine reference, validation and roadmap in one file.
- [User guide](docs/USER-GUIDE.md): normal use and recovery.

The `distribution/` directory also contains the earlier self-contained installer
and Git source bundle. They are optional when using this extracted package.
