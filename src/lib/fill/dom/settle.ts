/** A bounded observation window catches framework reverts without promising
 * that a website can never change its state later. */
export async function waitForCommitted(
  accepts: () => boolean,
  signal?: AbortSignal,
  timeoutMs = 900,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let stableSince: number | null = null;
  while (Date.now() <= deadline) {
    if (signal?.aborted) return false;
    if (accepts()) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= 250) return true;
    } else stableSince = null;
    await new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, 25);
      signal?.addEventListener('abort', finish, { once: true });
    });
  }
  return false;
}
