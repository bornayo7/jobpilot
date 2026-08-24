import type { AtsId } from './ids';

/**
 * Detect which ATS a frame belongs to from its host (+ path for hosts that
 * serve more than jobs). Host-based only — page-content sniffing is fragile
 * and runs too early. Returns null for unrecognized sites (generic heuristics
 * still apply there once the user enables the site).
 */
export function detectAts(host: string, path: string): AtsId | null {
  const h = host.toLowerCase();

  if (h === 'job-boards.greenhouse.io' || h === 'boards.greenhouse.io' || h.endsWith('.greenhouse.io'))
    return 'greenhouse';
  if (h === 'jobs.lever.co' || h === 'jobs.eu.lever.co') return 'lever';
  if (h === 'jobs.ashbyhq.com') return 'ashby';
  if (h.endsWith('.myworkdayjobs.com') || h.endsWith('.myworkdaysite.com')) return 'workday';
  if (h.endsWith('.icims.com')) return 'icims';
  if (h === 'jobs.smartrecruiters.com' || h === 'careers.smartrecruiters.com') return 'smartrecruiters';
  if (h === 'smartapply.indeed.com') return 'indeed';
  if ((h === 'www.linkedin.com' || h === 'linkedin.com') && path.startsWith('/jobs')) return 'linkedin';

  return null;
}

export const ATS_LABELS: Record<AtsId, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday',
  icims: 'iCIMS',
  smartrecruiters: 'SmartRecruiters',
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
};
