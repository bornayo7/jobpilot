import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ResumeVersion } from '../schema/resumeVersion';
import { renderPdfToBytes } from './renderToBytes';
import { wrapPdfText } from './pdfText';

// ATS rule: no soft hyphens in the text layer — parsers extract them as
// garbage characters mid-word.
Font.registerHyphenationCallback((word) => [word]);

/**
 * Single-column, ATS-safe resume. Built-in Helvetica (a PDF standard font)
 * keeps the text layer clean with zero font assets; component order IS the
 * extraction order, which validatePdf asserts after every render.
 */
const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    lineHeight: 1.35,
    paddingVertical: 36,
    paddingHorizontal: 44,
    color: '#111111',
  },
  name: { fontSize: 19, fontFamily: 'Helvetica-Bold' },
  contactLine: { fontSize: 9.5, marginTop: 3, color: '#333333' },
  section: { marginTop: 12 },
  sectionTitle: {
    fontSize: 10.5,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    borderBottomWidth: 0.8,
    borderBottomColor: '#444444',
    paddingBottom: 2,
    marginBottom: 5,
  },
  entry: { marginBottom: 7 },
  entryHead: { marginBottom: 2 },
  entryTitle: { fontFamily: 'Helvetica-Bold' },
  entryMeta: { color: '#333333' },
  entrySub: { marginBottom: 2 },
  bullet: { marginLeft: 10, textIndent: -10, marginBottom: 1.5 },
  summary: { marginBottom: 2 },
  skillLine: { marginBottom: 2 },
});

export function ResumePdf({ version }: { version: ResumeVersion }) {
  const { basics } = version;
  const contact = [basics.location, basics.email, basics.phone]
    .filter(Boolean)
    .join('  |  ');

  return (
    <Document title={`${basics.name} resume`} author={basics.name}>
      <Page size="LETTER" style={styles.page}>
        {/* Contact info in the BODY — headers/footers are invisible to many ATS parsers. */}
        <Text style={styles.name}>{wrapPdfText(basics.name, 26)}</Text>
        {contact ? <Text style={styles.contactLine}>{wrapPdfText(contact)}</Text> : null}
        {basics.links.map((link, index) => <Text key={index} style={styles.contactLine}>{wrapPdfText(link)}</Text>)}

        {version.summary ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} minPresenceAhead={28}>Summary</Text>
            <Text style={styles.summary}>{wrapPdfText(version.summary)}</Text>
          </View>
        ) : null}

        {version.experience.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} minPresenceAhead={50}>Work Experience</Text>
            {version.experience.map((entry, i) => (
              <View key={i} style={styles.entry}>
                <View style={styles.entryHead}>
                  <Text style={styles.entryTitle} minPresenceAhead={28}>{wrapPdfText(entry.title)}</Text>
                  <Text style={styles.entryMeta}>{wrapPdfText(entry.dates)}</Text>
                </View>
                <View style={styles.entrySub}>
                  <Text>{wrapPdfText(entry.company)}</Text>
                  <Text style={styles.entryMeta}>{wrapPdfText(entry.location)}</Text>
                </View>
                {entry.bullets.map((bullet, j) => (
                  <Bullet key={j} text={bullet} />
                ))}
              </View>
            ))}
          </View>
        )}

        {version.projects.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} minPresenceAhead={50}>Projects</Text>
            {version.projects.map((project, i) => (
              <View key={i} style={styles.entry}>
                <View style={styles.entryHead}>
                  <Text style={styles.entryTitle} minPresenceAhead={28}>{wrapPdfText(project.name)}</Text>
                  <Text style={styles.entryMeta}>{wrapPdfText(project.tech)}</Text>
                </View>
                {project.url ? <Text style={styles.entryMeta}>{wrapPdfText(project.url)}</Text> : null}
                {project.bullets.map((bullet, j) => (
                  <Bullet key={j} text={bullet} />
                ))}
              </View>
            ))}
          </View>
        )}

        {version.education.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} minPresenceAhead={50}>Education</Text>
            {version.education.map((entry, i) => (
              <View key={i} style={styles.entry}>
                <View style={styles.entryHead}>
                  <Text style={styles.entryTitle} minPresenceAhead={28}>{wrapPdfText(entry.school)}</Text>
                  <Text style={styles.entryMeta}>{wrapPdfText(entry.dates)}</Text>
                </View>
                <Text>{wrapPdfText([entry.degree, entry.details].filter(Boolean).join('  ·  '))}</Text>
              </View>
            ))}
          </View>
        )}

        {version.skills.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} minPresenceAhead={28}>Skills</Text>
            {version.skills.map((group, i) => (
              <Text key={i} style={styles.skillLine}>
                {wrapPdfText(`${group.category ? `${group.category}: ` : ''}${group.items.join(', ')}`)}
              </Text>
            ))}
          </View>
        )}
      </Page>
    </Document>
  );
}

function Bullet({ text }: { text: string }) {
  // A single text flow can split across pages without shrinking its container
  // or leaving a separate bullet glyph stranded on the previous page.
  return <Text style={styles.bullet}>{`•  ${wrapPdfText(text)}`}</Text>;
}

export function renderResumePdf(version: ResumeVersion): Promise<ArrayBuffer> {
  return renderPdfToBytes(<ResumePdf version={version} />);
}
