const accounts = require('./claudeTeamAccounts.service');
const limits = require('./claudeTeamLimits');
const { cliQueue } = require('./cliQueue');
const { cliStatus } = require('./claudeTeamPersonal');

// Health of every Claude Team seat behind Prakasa AI, for the Super Admin card
// and the 5-minute health job: login, usage window, queue. A CLI seat is this
// server's own login; a gateway seat is asked through its runner's /v2/health.

async function runnerHealth(account, fetchImpl) {
  const url = String(account.gatewayUrl || '').replace(/\/+$/, '');
  try {
    const res = await fetchImpl(`${url}/v2/health`, {
      headers: { 'x-prakasa-ai-gateway-secret': account.gatewaySecret },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return { reachable: true, version: 1 };
    if (!res.ok) return { reachable: false, error: `HTTP ${res.status}` };
    return { reachable: true, ...(await res.json()) };
  } catch (error) {
    return { reachable: false, error: error?.name === 'TimeoutError' ? 'timeout' : 'unreachable' };
  }
}

async function listSeatHealth({ fetchImpl = globalThis.fetch } = {}) {
  const all = (await accounts.listAccounts({ includeSecret: true })).filter((a) => a.enabled);
  const seats = [];
  for (const account of all) {
    if (account.mode === 'cli') {
      const cli = await cliStatus();
      if (typeof cli.loggedIn === 'boolean') await limits.recordLogin('cli', { loggedIn: cli.loggedIn, error: cli.loggedIn ? null : 'logged_out' });
      seats.push({ accountId: account.id, label: account.label, mode: 'cli', reachable: true, ...(await limits.snapshot('cli')), queue: cliQueue.stats() });
    } else {
      const key = `gateway:${account.id}`;
      const runner = await runnerHealth(account, fetchImpl);
      if (runner.reachable && typeof runner.loggedIn === 'boolean') {
        await limits.recordLogin(key, { loggedIn: runner.loggedIn, error: runner.loggedIn ? null : 'logged_out' });
      } else if (!runner.reachable) {
        await limits.recordLogin(key, { loggedIn: false, error: `runner ${runner.error}` });
      }
      const snap = await limits.snapshot(key);
      seats.push({
        accountId: account.id, label: account.label, mode: 'gateway', reachable: runner.reachable, runnerVersion: runner.version || null,
        ...snap,
        // The runner's own window is fresher when it has one.
        ...(runner.limits?.rateType ? { rateType: runner.limits.rateType, utilization: runner.limits.utilization, resetsAt: runner.limits.resetsAt } : {}),
        queue: runner.queue || null,
        lastError: runner.reachable ? snap.lastError : `Runner tidak terjangkau (${runner.error})`,
      });
    }
  }
  return seats;
}

module.exports = { listSeatHealth, runnerHealth };
