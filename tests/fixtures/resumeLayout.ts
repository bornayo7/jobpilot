import { ResumeVersionSchema } from '../../src/lib/schema/resumeVersion';

/** Synthetic content deliberately exceeds one page within a single role. */
export const layoutStressResume = ResumeVersionSchema.parse({
  meta: { label: 'Layout stress', company: 'Example Research', role: 'Platform Engineer' },
  basics: {
    name: 'Éléonore María Fernández García de la Cruz y Rodríguez',
    location: 'Montréal, Québec', email: 'eleonore.fernandez@example.com', phone: '+1 514 555 0123',
    links: ['https://example.com/eleonore-fernandez/portfolio/distributed-systems/accessibility/research/platform-engineering/technical-documentation/reliability/observability/international-collaboration'],
  },
  summary: 'Platform engineer building accessible distributed systems for research teams in Montréal and São Paulo. Designs reliable services, clear documentation, and maintainable tools.',
  experience: [{
    title: 'Senior Software Engineer and Technical Lead for Distributed Research Infrastructure, Inclusive Developer Experience and International Collaboration',
    dates: 'September 2020 - December 2026',
    company: 'International Centre for Collaborative Scientific Research and Accessible Technology',
    location: 'Montréal, Québec / Remote',
    bullets: Array.from({ length: 24 }, (_, index) => `Achievement ${String(index + 1).padStart(2, '0')}: Designed reliable distributed services and accessible tools for international research teams, improving deployment safety while preserving clear documentation and measurable service quality across multiple environments.`),
  }, {
    title: 'Software Engineer', dates: 'January 2017 - August 2020', company: 'Example Systems', location: 'São Paulo',
    bullets: ['Built a deployment dashboard used by engineering teams to diagnose and recover from interrupted releases.'],
  }],
  projects: [{
    name: 'Accessible Research and Collaborative Data Processing Workbench',
    tech: 'TypeScript, PostgreSQL, React, Web Workers, OpenTelemetry, Docker, Python',
    url: 'https://example.com/projects/collaborative-research-workbench/distributed-processing/technical-documentation',
    bullets: ['Created an accessible workbench with keyboard navigation and recoverable local drafts.', 'Measured long-running tasks and published reproducible results for collaborators.'],
  }],
  education: [{ school: 'Université de Montréal Faculty of Engineering and Applied Computational Sciences', dates: 'September 2012 - June 2016', degree: 'Bachelor of Applied Science in Software Engineering', details: 'Research in reliable software systems and inclusive interaction design' }],
  skills: [{ category: 'Languages and platforms', items: ['TypeScript', 'Python', 'PostgreSQL', 'React', 'Docker', 'OpenTelemetry'] }],
});
