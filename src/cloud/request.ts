// Compatible with Safari 15.4 (does not require AbortSignal.timeout).
// A timeout never proves a write failed: the durable queue must retry the same ID.
export const timedFetch: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init?.signal?.aborted) controller.abort();
  init?.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 15000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", abort);
  }
};
