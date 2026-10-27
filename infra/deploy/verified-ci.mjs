// A PR run's head_sha names the proposed commit, but checkout tests its merge
// tree. Release evidence must come from a run that checked out the source SHA.
export function hasVerifiedSourceRun(runs, sourceSha) {
  if (!Array.isArray(runs) || !/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new TypeError('Require workflow runs and a complete immutable source SHA.');
  }
  return runs.some(run => run?.head_sha === sourceSha &&
    run.status === 'completed' && run.conclusion === 'success' &&
    ['push', 'workflow_dispatch'].includes(run.event));
}
