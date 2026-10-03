// Promise.all with at most `limit` calls running at once, results in input
// order. The database pool has five connections for the whole process: a
// dashboard that fires sixty queries with Promise.all takes all five and makes
// every other user's request wait behind it (load test, 1 Oct 2026). Three at
// a time leaves room for everyone else. Rejects with the first error, like
// Promise.all (callers that must not fail catch inside `fn`).
const DEFAULT_LIMIT = 3;

async function mapLimit(items, limit, fn) {
  const list = Array.from(items || []);
  const results = new Array(list.length);
  const width = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, list.length));
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed && next < list.length) {
      const i = next;
      next += 1;
      try {
        results[i] = await fn(list[i], i);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}

module.exports = { mapLimit, DEFAULT_LIMIT };
