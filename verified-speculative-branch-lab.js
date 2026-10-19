/** Cooperative capability boundary, not a security sandbox for untrusted JavaScript.
 * The default adapter isolates UTF-8 artifact maps in memory, not Git worktrees.
 * A production sandbox adapter must additionally restrict ambient network/process APIs.
 */
const clone = value => JSON.parse(JSON.stringify(value));
const artifactMap = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(v => typeof v !== 'string')) throw new TypeError('Artifacts must map names to string content');
  return clone(value);
};
export const memoryBranchAdapter = {
  kind: 'isolated in-memory artifact maps',
  async create({ artifacts }) {
    const files = new Map(Object.entries(artifactMap(artifacts)));
    return { read: key => files.get(key), write: (key, value) => { if (typeof key !== 'string' || !key || typeof value !== 'string') throw new TypeError('write requires a name and string content'); files.set(key, value); }, snapshot: () => Object.fromEntries(files), dispose() { files.clear(); } };
  },
};
/** All candidates and promoted output receive exactly the same checks.
 * Custom adapter.create({id,artifacts}) returns read/write/snapshot/dispose capabilities.
 * Only declared read-only tools are exposed. Cost and step bounds cover supplied
 * capabilities; they cannot interrupt an arbitrary callback or measure provider cost.
 */
export async function runSpeculativeBranches({ baseArtifacts = {}, candidates, checks, tools = {}, limits = {}, adapter = memoryBranchAdapter, promote = artifacts => artifacts }) {
  const cap = { maxBranches: 3, maxSteps: 30, maxCost: 10, ...limits };
  for (const key of ['maxBranches', 'maxSteps']) if (!Number.isSafeInteger(cap[key]) || cap[key] < 1) throw new TypeError(`${key} must be a positive integer`);
  if (!Number.isFinite(cap.maxCost) || cap.maxCost < 0) throw new TypeError('maxCost must be nonnegative');
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > cap.maxBranches) throw new Error('Candidate count exceeds branch bounds');
  if (new Set(candidates.map(c => c.id)).size !== candidates.length || candidates.some(c => !c.id || typeof c.run !== 'function')) throw new TypeError('Candidates require unique ids and run callbacks');
  if (!Array.isArray(checks) || !checks.length || new Set(checks.map(c => c.id)).size !== checks.length || checks.some(c => !c.id || typeof c.verify !== 'function')) throw new TypeError('Unique common verification checks are required');
  const baseline = artifactMap(baseArtifacts), records = []; let totalCost = 0, totalSteps = 0;
  const verify = async artifacts => Promise.all(checks.map(async check => { try { const value = await check.verify(Object.freeze(artifactMap(artifacts))); return { id: check.id, passed: value === true || value?.passed === true }; } catch (error) { return { id: check.id, passed: false, error: error.message }; } }));
  for (const candidate of candidates) {
    const costBefore = totalCost, stepsBefore = totalSteps;
    const workspace = await adapter.create({ id: candidate.id, artifacts: artifactMap(baseline) });
    let open = true, violation = null;
    const refuse = message => { violation = message; throw new Error(message); };
    const step = () => { if (!open) throw new Error('Branch closed'); if (totalSteps >= cap.maxSteps) refuse('Step budget exhausted'); totalSteps += 1; };
    const spend = amount => { if (!Number.isFinite(amount) || amount < 0) refuse('Invalid cost'); if (totalCost + amount > cap.maxCost) refuse('Cost budget exhausted'); totalCost += amount; };
    const ctx = Object.freeze({
      read: key => { step(); return workspace.read(key); },
      write: (key, value) => { step(); return workspace.write(key, value); },
      snapshot: () => { step(); return artifactMap(workspace.snapshot()); }, step,
      spend: amount => { step(); spend(amount); },
      tool: async (name, args = {}) => { step(); const tool = Object.hasOwn(tools, name) ? tools[name] : null; if (!tool || tool.readOnly !== true || tool.externalSideEffect === true) refuse(`Side-effecting or undeclared tool refused: ${name}`); spend(tool.cost ?? 0); return clone(await tool.execute(clone(args))); },
    });
    try {
      await candidate.run(ctx);
      if (violation) throw new Error(violation);
      const artifacts = artifactMap(workspace.snapshot()), results = await verify(artifacts);
      records.push({ id: candidate.id, accepted: results.every(r => r.passed), checks: results, artifacts, cost: totalCost - costBefore, steps: totalSteps - stepsBefore });
    } catch (error) { records.push({ id: candidate.id, accepted: false, error: error.message, cost: totalCost - costBefore, steps: totalSteps - stepsBefore }); }
    finally { open = false; await workspace.dispose?.(); }
  }
  const selected = records.filter(r => r.accepted).sort((a, b) => a.cost - b.cost || a.steps - b.steps)[0];
  if (!selected) return { status: 'ESCALATE', selectedId: null, candidates: records, isolation: adapter.kind ?? 'custom adapter', totalCost, totalSteps, artifacts: baseline };
  const artifacts = artifactMap(await promote(artifactMap(selected.artifacts), selected.id));
  const finalChecks = await verify(artifacts);
  return { status: finalChecks.every(r => r.passed) ? 'FINISH' : 'ESCALATE', selectedId: selected.id, candidates: records, artifacts, finalChecks, totalCost, totalSteps, isolation: adapter.kind ?? 'custom adapter' };
}
