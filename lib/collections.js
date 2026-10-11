// Preserve input order while bounding storage/provider requests in flight.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  let failed = false;
  let failure;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i], i); }
      catch (err) { if (!failed) failure = err; failed = true; }
    }
  }));
  if (failed) throw failure;
  return out;
}
