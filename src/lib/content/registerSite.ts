import { browser } from '#imports';

export interface SiteTarget { origin: string; tabId: number; url: string }

/** The permission prompt stays in the panel's user gesture. Completion means
 * the worker acknowledged registration and reload, not merely permission. */
export async function enableCurrentSite(tabId: number, register: (target: SiteTarget) => Promise<void>): Promise<string> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== tabId || !tab.url || !/^https?:/.test(tab.url)) {
    throw new Error('Open the job page, then click the JobPilot toolbar icon and try again.');
  }
  const origin = new URL(tab.url).origin;
  if (!await browser.permissions.request({ origins: [`${origin}/*`] })) {
    throw new Error('Permission declined. JobPilot cannot see this site without it.');
  }
  await register({ origin, tabId, url: tab.url });
  return origin;
}

/** Registration is persistent. Reload only the exact page that requested it. */
export async function registerEnabledSite({ origin, tabId, url }: SiteTarget): Promise<void> {
  const page = new URL(url);
  if (!/^https?:$/.test(page.protocol) || page.origin !== origin) throw new Error('The requested site is invalid.');
  if (!await browser.permissions.contains({ origins: [`${origin}/*`] })) throw new Error('Permission is no longer granted. Enable this site again.');
  const assertCurrentPage = async () => {
    if ((await browser.tabs.get(tabId)).url !== url) throw new Error('The page changed before JobPilot was enabled. Return to the job page and try again.');
  };
  await assertCurrentPage();
  // Include the scheme: granting HTTP must not masquerade as HTTPS access.
  const id = `jobpilot-site-${page.protocol.slice(0, -1)}-${page.host}`;
  const existing = await browser.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length === 0) {
    await browser.scripting.registerContentScripts([{
      id, js: ['content-scripts/ats.js'], matches: [`${origin}/*`],
      allFrames: true, runAt: 'document_idle', persistAcrossSessions: true,
    }]);
  }
  await assertCurrentPage();
  await browser.tabs.reload(tabId);
}
