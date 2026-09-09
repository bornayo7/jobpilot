import 'fake-indexeddb/auto';
import { fakeBrowser } from 'wxt/testing/fake-browser';

// Real extension storage returns a fresh structured clone. The vendor fake
// returns its own stored object, masking read/modify/write races between pages.
for (const area of [fakeBrowser.storage.local, fakeBrowser.storage.session, fakeBrowser.storage.sync]) {
  type Keys = string | string[] | Record<string, unknown> | null;
  const get = area.get.bind(area) as (keys?: Keys) => Promise<Record<string, unknown>>;
  // The application uses the Promise overload of the browser wrapper; retaining
  // its overloaded static type keeps callers' generic storage result types.
  area.get = (async (keys?: Keys) => structuredClone(await get(keys))) as unknown as typeof area.get;
}
