const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const required = (value, name) => { if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a nonempty string.`); };
const validHash = (value, name) => { if (value !== null && (typeof value !== 'string' || !HASH.test(value))) throw new Error(`${name} must be a SHA-256 hash or null.`); };

export function createWorkerBrief(input) {
  if (!isObject(input)) throw new Error('Worker brief must be an object.');
  for (const name of ['runId', 'setId', 'componentId', 'expectedSnapshot', 'styleHash']) required(input[name], `worker ${name}`);
  if (!ID.test(input.runId) || !ID.test(input.setId) || !ID.test(input.componentId)) throw new Error('Worker identifiers are invalid.');
  validHash(input.expectedSnapshot, 'worker expectedSnapshot'); validHash(input.styleHash, 'worker styleHash');
  if (!Array.isArray(input.assignedPaths) || input.assignedPaths.some(path => typeof path !== 'string' || path.startsWith('/') || path.split('/').includes('..'))) throw new Error('Worker assignedPaths must be repository-relative.');
  if (!isObject(input.expectedDocumentHashes)) throw new Error('Worker expectedDocumentHashes must be an object.');
  for (const [path, hash] of Object.entries(input.expectedDocumentHashes)) { if (path.startsWith('/') || path.split('/').includes('..')) throw new Error('Worker document paths must be repository-relative.'); validHash(hash, `worker document hash ${path}`); }
  return { schemaVersion: 2, taskId: input.taskId || `${input.runId}:${input.componentId}`, runId: input.runId, setId: input.setId, componentId: input.componentId, status: 'pending', expectedSnapshot: input.expectedSnapshot, expectedDocumentHashes: { ...input.expectedDocumentHashes }, styleHash: input.styleHash, assignedPaths: [...input.assignedPaths], readerQuestions: [...(input.readerQuestions || [])], budget: input.budget || null, readSet: {}, resultPath: null, integration: 'pending', createdAt: input.createdAt || new Date().toISOString(), updatedAt: input.createdAt || new Date().toISOString() };
}

export function validateWorkerResult(result, brief, current) {
  if (!isObject(result) || !isObject(brief)) throw new Error('Worker result and brief must be objects.');
  if (result.taskId !== brief.taskId || result.runId !== brief.runId) throw new Error('Worker result identity does not match its brief.');
  if (result.expectedSnapshot !== brief.expectedSnapshot || result.styleHash !== brief.styleHash) throw new Error('Worker result is stale against the brief baseline.');
  if (current?.snapshot && current.snapshot !== brief.expectedSnapshot) throw new Error('Worker result source snapshot is stale.');
  if (current?.documentHashes) for (const [path, expected] of Object.entries(brief.expectedDocumentHashes)) if (current.documentHashes[path] !== expected) throw new Error(`Worker document baseline changed: ${path}`);
  if (!isObject(result.readSet)) throw new Error('Worker result readSet is required.');
  for (const [path, hash] of Object.entries(result.readSet)) { if (path.startsWith('/') || path.split('/').includes('..')) throw new Error('Worker readSet paths must be repository-relative.'); validHash(hash, `worker readSet ${path}`); }
  return { ...result, status: 'completed', integration: 'pending', validatedAt: new Date().toISOString() };
}
