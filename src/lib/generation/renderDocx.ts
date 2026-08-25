import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
} from 'docx';
import type { ResumeVersion } from '../schema/resumeVersion';

const PAGE_WIDTH_TWIPS = 12240 - 2 * 1080; // Letter minus 0.75" margins

/**
 * DOCX twin of the PDF, built from the same ResumeVersion JSON so the two can
 * never drift. Contact info lives in body paragraphs — DOCX headers/footers
 * are invisible to many ATS parsers.
 */
export function buildResumeDocx(version: ResumeVersion): Document {
  const { basics } = version;
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      children: [new TextRun({ text: basics.name, bold: true, size: 38 })],
      spacing: { after: 60 },
    }),
  );
  const contact = [basics.location, basics.email, basics.phone, ...basics.links].filter(Boolean).join('  |  ');
  if (contact) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: contact, size: 19, color: '333333' })],
        spacing: { after: 160 },
      }),
    );
  }

  if (version.summary) {
    children.push(sectionHeading('Summary'));
    children.push(new Paragraph({ children: [new TextRun({ text: version.summary, size: 20 })], spacing: { after: 120 } }));
  }

  if (version.experience.length > 0) {
    children.push(sectionHeading('Work Experience'));
    for (const entry of version.experience) {
      children.push(headLine(entry.title, entry.dates));
      children.push(subLine(entry.company, entry.location));
      for (const bullet of entry.bullets) children.push(bulletPara(bullet));
      children.push(spacer());
    }
  }

  if (version.projects.length > 0) {
    children.push(sectionHeading('Projects'));
    for (const project of version.projects) {
      children.push(headLine(project.name, project.tech));
      if (project.url) children.push(subLine(project.url, ''));
      for (const bullet of project.bullets) children.push(bulletPara(bullet));
      children.push(spacer());
    }
  }

  if (version.education.length > 0) {
    children.push(sectionHeading('Education'));
    for (const entry of version.education) {
      children.push(headLine(entry.school, entry.dates));
      children.push(subLine([entry.degree, entry.details].filter(Boolean).join('  ·  '), ''));
      children.push(spacer());
    }
  }

  if (version.skills.length > 0) {
    children.push(sectionHeading('Skills'));
    for (const group of version.skills) {
      children.push(
        new Paragraph({
          children: [
            ...(group.category ? [new TextRun({ text: `${group.category}: `, bold: true, size: 20 })] : []),
            new TextRun({ text: group.items.join(', '), size: 20 }),
          ],
          spacing: { after: 60 },
        }),
      );
    }
  }

  return new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 20 } } } },
    sections: [
      {
        properties: {
          page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } },
        },
        children,
      },
    ],
  });
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 21 })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '444444' } },
    spacing: { before: 200, after: 100 },
  });
}

function headLine(left: string, right: string): Paragraph {
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: PAGE_WIDTH_TWIPS }],
    children: [
      new TextRun({ text: left, bold: true, size: 20 }),
      ...(right ? [new TextRun({ children: [new Tab(), right], size: 19, color: '333333' })] : []),
    ],
    spacing: { after: 30 },
  });
}

function subLine(left: string, right: string): Paragraph {
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: PAGE_WIDTH_TWIPS }],
    children: [
      new TextRun({ text: left, size: 20 }),
      ...(right ? [new TextRun({ children: [new Tab(), right], size: 19, color: '333333' })] : []),
    ],
    spacing: { after: 40 },
  });
}

function bulletPara(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 20 })],
    bullet: { level: 0 },
    spacing: { after: 30 },
  });
}

function spacer(): Paragraph {
  return new Paragraph({ children: [], spacing: { after: 60 } });
}

/** Render to bytes in both environments (extension page and Node tests). */
export async function renderResumeDocx(version: ResumeVersion): Promise<ArrayBuffer> {
  const doc = buildResumeDocx(version);
  if (typeof Blob !== 'undefined' && typeof (Packer as { toBlob?: unknown }).toBlob === 'function') {
    try {
      const blob = await Packer.toBlob(doc);
      return await blob.arrayBuffer();
    } catch {
      // Fall through to buffer path (Node without Blob-stream support).
    }
  }
  const buffer = await Packer.toBuffer(doc);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
