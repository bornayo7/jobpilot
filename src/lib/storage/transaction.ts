/** Await the commit as well as requests. A request failure must not leave a
 * second unhandled done rejection or a partially queued transaction alive. */
export async function completeTransaction<T>(
  transaction: { done: Promise<void>; abort(): void },
  operation: () => Promise<T>,
): Promise<T> {
  void transaction.done.catch(() => undefined);
  try {
    const value = await operation();
    await transaction.done;
    return value;
  } catch (error) {
    try { transaction.abort(); } catch { /* Already finished or aborted. */ }
    await transaction.done.catch(() => undefined);
    throw error;
  }
}
