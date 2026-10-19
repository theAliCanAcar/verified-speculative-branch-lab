# Verified Speculative Branch Lab

Compare isolated candidate repairs under shared checks.

Standalone ES module. No npm install required. Works in **Node.js 20+** and modern browsers (serve over HTTP for browser demos).

## Install / import

Copy the files into your project, or clone this repository:

```js
import { runSpeculativeBranches } from './verified-speculative-branch-lab.js';

// Explore two invoice repairs independently, then recheck promoted output.
const result = await runSpeculativeBranches({
  baseArtifacts: { 'invoice.json': '{"total":0}' },
  candidates: [
    { id: 'rounding-error', run: ctx => ctx.write('invoice.json', '{"total":41}') },
    { id: 'correct-total', run: ctx => ctx.write('invoice.json', '{"total":42}') },
  ],
  checks: [{ id: 'total', verify: files => JSON.parse(files['invoice.json']).total === 42 }],
  limits: { maxBranches: 2, maxSteps: 4, maxCost: 1 },
});
console.log(result.status, result.selectedId, result.artifacts);
// FINISH, correct-total. Isolation is in-memory, not a Git worktree or security sandbox.
```

## Use cases

### 1. Compare two repairs without shared edits

- **Scenario:** Two candidate implementations try to repair the same generated artifact.
- **Outcome:** Run candidates in isolated artifact maps, apply common checks, and recheck the promoted result.

### 2. Reject side effects during exploration

- **Scenario:** A candidate tries to send a message while testing a plan.
- **Outcome:** Refuse external tools in speculative work and route a final action through a separate commit policy.

## Exports

- `memoryBranchAdapter`
- `runSpeculativeBranches`

## Notes

- Keep API keys and secrets out of this module and out of browser storage.
- Treat verification callbacks, ledger writers, and permission checks as trusted application code.
- This library is intentional local reliability plumbing, not a claim of cryptographic attestation unless stated in the source comments.

## License

MIT
