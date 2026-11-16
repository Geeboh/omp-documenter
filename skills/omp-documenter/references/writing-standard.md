# Clear and consistent documentation

## Contents

1. Write for the reader's task
2. Use a consistent page structure
3. Write usable procedures
4. Present configuration and reference material
5. Explain failures and security
6. Maintain navigation and examples
7. Apply the editorial acceptance check

## 1. Write for the reader's task

Start each page with its purpose, intended reader, and the result the reader can achieve. Explain what a component does before explaining how its implementation works. Use plain English, direct verbs, and short paragraphs that develop one idea at a time.

Assume an intelligent reader who may not know this repository. Define unfamiliar terms on first use and link to the glossary. Keep the same term for the same concept throughout the library. When the code uses a less friendly name, show the friendly explanation alongside the exact identifier.

Separate three kinds of information:

- **Instructions:** actions the reader can carry out.
- **Reference:** exact options, contracts, constraints, and behavior.
- **Explanation:** how the parts fit together and why a behavior matters.

Keep these easy to distinguish without creating redundant pages. Link to a canonical explanation instead of repeating it with subtly different wording.

Use the repository's spelling and capitalization consistently. Avoid vague terms such as "simply," "obviously," "various," "appropriate," and "as needed" when the reader needs a concrete condition or choice. Avoid unexplained acronyms and unnecessary jargon.

## 2. Use a consistent page structure

Use a single level-one title, descriptive level-two sections, and a shallow hierarchy. Do not skip heading levels. Prefer headings such as "Start the service" or "Choose a storage directory" to generic headings such as "Details."

A typical guide has:

1. Purpose and expected outcome.
2. Prerequisites and environment.
3. Procedure or explanation.
4. Verification and expected result.
5. Failure and recovery guidance.
6. Related pages and source evidence.

Only include sections that serve the page. A justified "not applicable" note is acceptable when a required topic does not apply. An empty section or a generic "TBD" is not completed documentation.

Use the package's `templates/chapter.md` as a starting point when useful. Replace every authoring placeholder before publishing. Retain a visible unknown with a resolution step when a fact cannot be established.

## 3. Write usable procedures

State prerequisites before the first action:

| Requirement | What to include |
| --- | --- |
| Platform | Supported OS, runtime, architecture, or explicit unknown |
| Access | Required identity and permissions; explain when elevated privileges are necessary |
| Working directory | The exact repository or deployment directory used by the commands |
| Inputs | Required files, configuration, credentials, or artifacts without secret values |
| Existing state | Whether the service should be running, stopped, backed up, or already installed |
| Consequences | Material writes, downtime, migrations, or irreversible effects |

Then use numbered steps. Each step should perform one meaningful action and explain why it is needed when that is not obvious. Place the expected result immediately after the command or action it checks.

Make commands copyable:

- Put commands in fenced blocks with a language tag.
- Do not include shell prompts such as `$` or `root@host#` in runnable blocks.
- Use real, verified command syntax and the correct shell.
- Define every placeholder before use. Use values such as `/path/to/repository` only when the reader must substitute a path.
- Quote paths and variables correctly. Keep literal data separate from shell code.
- Do not hide required steps behind ellipses.
- Do not include credentials or plausible-looking secrets.
- Distinguish source-derived examples from commands actually executed.

For Python projects, use the repository's supported virtual environment workflow. Do not recommend global `pip` installation when a virtual environment is appropriate or required. Establish the package name and requirements from the repository rather than guessing from an import name.

For a procedure that changes state, explain what happens if a step fails, how the reader can recognize partial completion, and how to resume or recover. Only claim a rollback exists when the code or an established procedure supports it.

## 4. Present configuration and reference material

Use tables for options and contracts that readers need to compare exactly.

| Setting | Type | Default | Required | Accepted values | Effect | Source |
| --- | --- | --- | --- | --- | --- | --- |
| Actual key | Established type | Actual default or "not established" | Condition | Actual constraints | Concrete behavior | Path and symbol |

Explain configuration precedence with a specific sequence derived from the implementation. Distinguish a code default, example value, configured value, and observed runtime value. They are not interchangeable.

For functions and methods, use consistent fields: purpose, signature, parameters, return value, errors, side effects, example, and source. State "no return value" only when the language and implementation establish that. Describe asynchronous results and errors accurately.

For APIs, schemas, and commands, include units, encoding, optionality, defaults, boundary values, and validation where established. Use the same sample names, paths, and identifiers across related pages so readers can follow a workflow without translating between examples.

## 5. Explain failures and security

Organize troubleshooting around symptoms a reader can recognize:

| Symptom | Likely cause supported by evidence | Diagnostic check | Corrective action | Confirm recovery |
| --- | --- | --- | --- | --- |
| Actual message or behavior | A bounded explanation | A concrete, safe check | Specific steps | Observable success condition |

Do not invent "common" failures without evidence of frequency. Use "possible failure" when source shows a path but frequency is unknown. Avoid prescribing deletion, reset, or elevated privileges as a generic fix.

Explain security behavior concretely: who authenticates, what is authorized, where secrets come from, where permissions are checked, and which input crosses each trust boundary. Distinguish implemented protection from a recommended improvement. Do not describe the project as "secure," "safe," or "production ready" based on a few checks.

## 6. Maintain navigation and examples

Provide an index with links organized by task and audience. Add links to prerequisites, the relevant reference, and the next common task. Use descriptive link text; avoid "click here." Keep anchor text and headings stable when practical.

Use tables for mappings and comparisons. Use diagrams when a relationship or branching path is clearer visually. Give diagrams an explanatory caption and source references. Do not add a diagram that merely repeats a one-step instruction.

Keep examples realistic and minimal. Include enough context to run or adapt them. Show expected output only when observed, or explicitly identify it as a representative shape rather than a real result. Do not let output examples silently contradict current schemas or error messages.

Keep pages readable without a particular renderer. Avoid reliance on color alone, oversized tables, and deeply nested lists. Provide textual explanations for diagrams and meaningful alternate text for images.

## 7. Apply the editorial acceptance check

Before marking a page complete, confirm:

- Its purpose and intended reader are clear in the opening paragraph.
- It answers a real reader question and leads to a useful outcome.
- Terminology, capitalization, paths, commands, and examples match the rest of the library.
- Every command has the necessary context and every placeholder is explained.
- Procedures include prerequisites, expected results, and relevant recovery guidance.
- Assertions are bounded by their evidence; recommendations and unknowns are labeled.
- Headings, links, tables, and diagrams are useful and consistent.
- Reference entries cover actual inputs, outputs, errors, and side effects.
- No secrets, unexplained acronyms, stale placeholders, empty sections, or contradictory instructions remain.
- Related pages and the main index are updated.

Perform this review across the library as well as page by page. A mechanically valid link does not guarantee useful navigation, and a spelling check does not establish clarity.
