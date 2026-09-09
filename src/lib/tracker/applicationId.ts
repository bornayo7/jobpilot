import { detectAts } from '../fill/adapters/detect';
import { parseBoardUrl } from '../fill/adapters/greenhouse';

/** Identity follows requisitions; employer and title remain display text. */
export function applicationId(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const ats = detectAts(url.hostname, url.pathname);
  if (ats === 'greenhouse') {
    const ids = parseBoardUrl(raw);
    if (ids) return `greenhouse:${ids.boardToken}:${ids.jobId}`;
  }
  if ((ats === 'lever' || ats === 'ashby') && parts[0] && parts[1]) return `${ats}:${parts[0]}:${parts[1]}`;
  if (ats === 'smartrecruiters' && parts[0] && parts[1]) return `smartrecruiters:${parts[0]}:${parts[1].split('-')[0]}`;
  if (ats === 'icims' && parts[0] === 'jobs' && parts[1]) return `icims:${url.hostname}:${parts[1]}`;
  if (ats === 'linkedin') {
    const id = url.searchParams.get('currentJobId') ?? url.pathname.match(/\/view\/(\d+)/)?.[1];
    if (id) return `linkedin:${id}`;
  }
  url.hash = '';
  url.pathname = url.pathname.replace(/\/(apply|application|thanks|thank-you|confirmation|post-apply)\/?$/i, '').replace(/\/$/, '') || '/';
  // Unknown query parameters may be the site's only requisition identifier.
  // Strip known attribution noise, preserving everything else conservatively.
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|source|ref|referrer|referral|gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return `url:${url.href}`;
}
