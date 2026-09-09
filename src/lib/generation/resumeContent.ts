import type { ResumeVersion } from '../schema/resumeVersion';
export interface ResumeContentItem { label: string; text: string }

/** The reading order shared by the PDF and DOCX renderers. Validation checks
 * every meaningful value, including content that only projects-only resumes use. */
export function resumeContent(version: ResumeVersion): ResumeContentItem[] {
  const items: ResumeContentItem[] = [];
  const add = (label: string, text: string | undefined) => { if (text?.trim()) items.push({ label, text }); };
  const { basics } = version;
  add('name', basics.name);
  add('location', basics.location); add('email', basics.email); add('phone', basics.phone);
  basics.links.forEach((link) => add('contact link', link));
  if (version.summary) { add('summary heading', 'Summary'); add('summary', version.summary); }
  if (version.experience.length) add('experience heading', 'Work Experience');
  for (const entry of version.experience) {
    add('role', entry.title); add('employment dates', entry.dates); add('company', entry.company); add('employment location', entry.location);
    entry.bullets.forEach((bullet) => add('experience bullet', bullet));
  }
  if (version.projects.length) add('projects heading', 'Projects');
  for (const project of version.projects) {
    add('project', project.name); add('project technologies', project.tech); add('project URL', project.url);
    project.bullets.forEach((bullet) => add('project bullet', bullet));
  }
  if (version.education.length) add('education heading', 'Education');
  for (const entry of version.education) {
    add('school', entry.school); add('education dates', entry.dates); add('degree', entry.degree); add('education details', entry.details);
  }
  if (version.skills.length) add('skills heading', 'Skills');
  for (const group of version.skills) {
    add('skill category', group.category); group.items.forEach((skill) => add('skill', skill));
  }
  return items;
}
