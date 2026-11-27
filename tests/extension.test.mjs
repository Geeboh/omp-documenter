import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import documenter, { resolveRoot, workflowPrompt, formatReport } from "../src/index.js";

function host() {
  const captured = { tools: [], commands: [], prompts: [], messages: [], notices: [] };
  const schema = { optional() { return this; }, describe() { return this; } };
  const pi = {
    zod: { object: () => schema, enum: () => schema, string: () => schema, boolean: () => schema },
    registerTool: tool => captured.tools.push(tool),
    registerCommand: (name, value) => captured.commands.push({ name, ...value }),
    sendUserMessage: (...args) => captured.prompts.push(args),
    sendMessage: (...args) => captured.messages.push(args)
  };
  documenter(pi);
  return { captured, ctx: cwd => ({ cwd, isIdle: () => true, ui: { notify: (...args) => captured.notices.push(args) } }) };
}

test("registration has no filesystem or agent-turn side effects", () => {
  const { captured } = host();
  assert.deepEqual(captured.tools.map(t => t.name), ["documenter_state", "documenter_inspect"]);
  assert.deepEqual(captured.tools.map(t => t.approval), ["write", "read"]);
  assert.deepEqual(captured.commands.map(c => c.name), ["documenter"]);
  assert.equal(captured.prompts.length, 0);
  assert.equal(captured.messages.length, 0);
  assert.throws(() => documenter({}), /requires the OMP extension API/);
});

test("initial and maintenance prompt loads the exact bundled skill; idle starts, busy queues", async () => {
  const dir = mkdtempSync(join(tmpdir(), "documenter-host-"));
  try {
    const { captured, ctx } = host();
    const command = captured.commands[0];
    await command.handler("initial", ctx(dir));
    assert.match(captured.prompts[0][0], /initial mode/);
    assert.match(captured.prompts[0][0], /name: omp-documenter/);
    assert.equal(captured.prompts[0][1].attribution, "agent");
    assert.equal("deliverAs" in captured.prompts[0][1], false);
    await command.handler("maintain", { ...ctx(dir), isIdle: () => false });
    assert.equal(captured.prompts[1][1].deliverAs, "followUp");
    assert.deepEqual(readdirSync(dir), []);
    assert.throws(() => workflowPrompt("unknown", dir), /Mode/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


});
test("wizard yolo mode is explicit, autonomous and still collects required settings", async () => {
  const dir = mkdtempSync(join(tmpdir(), "documenter-host-wizard-yolo-"));
  try {
    const { captured, ctx } = host();
    const command = captured.commands[0];
    await command.handler("wizard yolo", ctx(dir));
    assert.match(captured.prompts[0][0], /explicit yolo mode/);
    assert.match(captured.prompts[0][0], /agent-yolo/);
    assert.match(captured.prompts[0][0], /project and release material/);
    await command.handler("wizard --yolo", ctx(dir));
    assert.match(captured.prompts[1][0], /explicit yolo mode/);
    await command.handler("wizard guided", ctx(dir));
    assert.match(captured.notices[0][0], /Usage: \/documenter wizard \[yolo\]/);
    assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
test("tool root cannot escape through traversal or a directory symlink", () => {
  const dir = mkdtempSync(join(tmpdir(), "documenter-host-root-"));
  try {
    const root = join(dir, "root");
    const outside = join(dir, "outside");
    mkdirSync(root); mkdirSync(outside); mkdirSync(join(root, "module"));
    symlinkSync(outside, join(root, "escape"));
    assert.equal(resolveRoot(root, "module"), join(root, "module"));
    assert.throws(() => resolveRoot(root, "../outside"), /must be the session directory/);
    assert.throws(() => resolveRoot(root, "escape"), /must be the session directory/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("malformed arguments and aborted tools return errors without state writes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "documenter-host-errors-"));
  try {
    const { captured, ctx } = host();
    const tool = captured.tools[0];
    const bad = await tool.execute("call1", { action: "record", inputJson: "{" }, undefined, undefined, ctx(dir));
    assert.equal(bad.isError, true);
    const cancelled = await tool.execute("call2", { action: "scan" }, { aborted: true }, undefined, ctx(dir));
    assert.equal(cancelled.isError, true);
    await captured.commands[0].handler("initial --strict", ctx(dir));
    assert.equal(captured.prompts.length, 0);
    assert.match(captured.notices[0][0], /Usage/);
    assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("status command inspects a fresh repository and displays a report without launching an agent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "documenter-host-status-"));
  try {
    writeFileSync(join(dir, "app.js"), "export const answer = 42;\n");
    const { captured, ctx } = host();
    await captured.commands[0].handler("status", ctx(dir));
    assert.equal(captured.prompts.length, 0);
    assert.equal(captured.messages.length, 1);
    assert.equal(captured.messages[0][1].triggerTurn, false);
    assert.equal(captured.messages[0][0].customType, "documenter-report");
    assert.match(captured.messages[0][0].content, /Source files reviewed \| 0 \/ 1/);
    assert.deepEqual(readdirSync(dir), ["app.js"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("human status reports preserve truncated totals and separate integrity from completion", () => {
  const report = formatReport({
    integrity: true, complete: false,
    coverage: { reviewed: { count: 2, denominator: 10 }, documentationPages: { count: 1, denominator: 3 } },
    attention: { unreviewed: ["a.js", "b.js"] }, truncation: { "attention.unreviewed": 8 }
  });
  assert.match(report, /Mechanical integrity: PASS/);
  assert.match(report, /Defined scope complete: no/);
  assert.match(report, /Source files awaiting review: 10/);
  assert.match(report, /Documentation pages reviewed \| 1 \/ 3/);
});
