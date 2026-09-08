import { detectAts } from '../fill/adapters/detect';

/**
 * Submission-confirmation detection. Tracker entries are only created when a
 * confirmation actually appears (copying the OSS lesson: submit-click alone
 * produces false "applied" records, the most common tracker complaint).
 */
// "Thank you for your interest in <company>" is a job-POSTING greeting as
// often as a confirmation, and this check runs on every page the content
// script is injected into. It only counts when the same sentence goes on to
// mention the application; the unqualified phrase created "applied" entries
// for postings the user had merely opened.
const CONFIRMATION_TEXT =
  /thank you for (applying|your application)|thank you for your interest in [^.!\n]{0,80}?\b(applying|application)\b|application (has been |was |is )?(submitted|received|sent|complete)|successfully (submitted|applied)|we('ve| have) received your application|your application to .{0,60} (was|has been) (sent|submitted)/i;

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

/** Derive the employer name from ATS URL structure; '' when the URL is unusable. */
export function companyFromUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return '';
  }
  const segment = (index: number) => decodeURIComponent(url.pathname.split('/').filter(Boolean)[index] ?? '');

  switch (detectAts(url.host, url.pathname)) {
    case 'lever':
    case 'ashby':
    case 'smartrecruiters':
      return titleCase(segment(0));
    case 'greenhouse':
      if (url.pathname.startsWith('/embed/job_app')) return titleCase(url.searchParams.get('for') ?? '');
      return titleCase(segment(0));
    case 'workday':
      return titleCase(url.host.split('.')[0] ?? '');
    case 'icims': {
      const match = url.host.match(/^(?:careers|jobs)[-.]([^.]+)\.icims\.com$/);
      return titleCase(match?.[1] ?? url.host);
    }
    default:
      return url.host.replace(/^www\./, '');
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
