import type { FormFieldDescriptor } from '../../messaging/protocol';
import type { FieldKind } from '../../schema/fieldKind';
import type { AtsAdapter, PrefetchedField } from './types';

/** Stable Greenhouse field names (also the multipart POST parameter names). */
const NAME_MAP: Record<string, FieldKind> = {
  first_name: 'name.first',
  last_name: 'name.last',
  email: 'contact.email',
  phone: 'contact.phone',
  resume: 'docs.resume',
  cover_letter: 'docs.coverLetter',
  // Classic EEOC compliance block:
  race: 'eeo.race',
  gender: 'eeo.gender',
  veteran_status: 'eeo.veteran',
  disability_status: 'eeo.disability',
};

export const greenhouseAdapter: AtsAdapter = {
  id: 'greenhouse',

  classify(field: FormFieldDescriptor): FieldKind | null {
    const name = field.name ?? '';
    if (NAME_MAP[name]) return NAME_MAP[name] ?? null;
    // job_application[location] and friends on legacy boards.
    if (/\[location\]$/.test(name) || name === 'auto_complete_input') return 'location.combined';
    // question_<int> ids are per-job — deliberately unresolved here.
    return null;
  },

  /**
   * The public Job Board API returns the exact per-job question schema:
   * labels, field names, required flags, and option values as the SERVER
   * knows them. Joined onto scraped descriptors by name so selects use real
   * server values and heuristics/LLM see authoritative labels.
   */
  async prefetchSchema(url: string): Promise<PrefetchedField[] | null> {
    const ids = parseBoardUrl(url);
    if (!ids) return null;

    const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ids.boardToken)}/jobs/${encodeURIComponent(ids.jobId)}?questions=true`;
    const res = await fetch(apiUrl).catch(() => null);
    if (!res || !res.ok) return null;

    const json: any = await res.json().catch(() => null);
    if (!json) return null;

    const fields: PrefetchedField[] = [];
    const questionGroups = [
      ...(json.questions ?? []),
      ...(json.demographic_questions?.questions ?? []),
      ...(json.compliance ?? []).flatMap((section: any) => section.questions ?? []),
    ];
    for (const question of questionGroups) {
      for (const field of question.fields ?? []) {
        fields.push({
          name: field.name,
          label: question.label ?? '',
          required: !!question.required,
          type: field.type ?? 'input_text',
          options: (field.values ?? []).map((v: any) => ({
            value: String(v.value),
            label: String(v.label ?? v.value),
          })),
        });
      }
    }
    return fields;
  },
};

export function parseBoardUrl(url: string): { boardToken: string; jobId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.host.endsWith('greenhouse.io')) return null;

  // Embed form: /embed/job_app?for={token}&token={jobId}
  if (parsed.pathname.startsWith('/embed/job_app')) {
    const boardToken = parsed.searchParams.get('for');
    const jobId = parsed.searchParams.get('token');
    return boardToken && jobId ? { boardToken, jobId } : null;
  }

  // Board form: /{token}/jobs/{jobId}
  const match = parsed.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
  if (match) return { boardToken: match[1]!, jobId: match[2]! };

  return null;
}
