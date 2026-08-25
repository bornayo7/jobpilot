import type { AtsId } from '../fill/adapters/ids';
import { detectAts } from '../fill/adapters/detect';

/**
 * Submission-confirmation detection. Tracker entries are only created when a
 * confirmation actually appears (copying the OSS lesson: submit-click alone
 * produces false "applied" records, the most common tracker complaint).
 */
const CONFIRMATION_TEXT =
  /thank you for (applying|your application|your interest in)|application (has been |was |is )?(submitted|received|sent|complete)|successfully (submitted|applied)|we('ve| have) received your application|your application to .{0,60} (was|has been) (sent|submitted)/i;

const CONFIRMATION_URL = /\/(thanks|thank-you|confirmation|already_applied|post-apply)\b/i;

export function looksLikeConfirmation(url: string, bodyText: string): boolean {
  if (CONFIRMATION_URL.test(url)) return true;
  return CONFIRMATION_TEXT.test(bodyText.slice(0, 6000));
}

/** Buttons whose activation counts as a submit attempt (answer snapshot time). */
const SUBMIT_BUTTON = /^(submit( application)?|apply( now)?|send( application)?|finish|review and submit)$/i;

export function looksLikeSubmitButton(text: string): boolean {
  return SUBMIT_BUTTON.test(text.trim().replace(/\s+/g, ' '));
}

/** Derive the employer name from ATS URL structure. */
export function companyFromUrl(rawUrl: string): { company: string; atsId: AtsId | null } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { company: '', atsId: null };
  }
  const atsId = detectAts(url.host, url.pathname);
  const segment = (index: number) => decodeURIComponent(url.pathname.split('/').filter(Boolean)[index] ?? '');

  switch (atsId) {
    case 'lever':
    case 'ashby':
      return { company: titleCase(segment(0)), atsId };
    case 'greenhouse': {
      if (url.pathname.startsWith('/embed/job_app')) {
        return { company: titleCase(url.searchParams.get('for') ?? ''), atsId };
      }
      return { company: titleCase(segment(0)), atsId };
    }
    case 'workday': {
      const tenant = url.host.split('.')[0] ?? '';
      return { company: titleCase(tenant), atsId };
    }
    case 'icims': {
      const match = url.host.match(/^(?:careers|jobs)[-.]([^.]+)\.icims\.com$/);
      return { company: titleCase(match?.[1] ?? url.host), atsId };
    }
    case 'smartrecruiters':
      return { company: titleCase(segment(0)), atsId };
    default:
      return { company: url.host.replace(/^www\./, ''), atsId };
  }
}

/** Strip ATS boilerplate from a document.title. */
export function cleanJobTitle(title: string): string {
  return title
    .replace(/\s*[-|–·]\s*(job application|apply|application|careers?|jobs?|greenhouse|lever|ashby|workday|icims|smartrecruiters|linkedin|indeed(\.com)?)\s*$/gi, '')
    .replace(/^(apply (for|to)|job application (for|to))\s*/i, '')
    .trim()
    .slice(0, 120);
}

function titleCase(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\p{L}/gu, (ch) => ch.toUpperCase());
}
