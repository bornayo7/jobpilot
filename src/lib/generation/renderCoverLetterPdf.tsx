import React from 'react';
import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

Font.registerHyphenationCallback((word) => [word]);

export interface LetterInfo {
  name: string;
  contactLine: string;
  company: string;
  date: string;
  body: string;
}

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 11,
    lineHeight: 1.5,
    paddingVertical: 54,
    paddingHorizontal: 60,
    color: '#111111',
  },
  name: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  contact: { fontSize: 9.5, color: '#333333', marginTop: 2, marginBottom: 22 },
  meta: { marginBottom: 16, color: '#333333' },
  paragraph: { marginBottom: 10 },
});

export function CoverLetterPdf({ letter }: { letter: LetterInfo }) {
  const paragraphs = letter.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <Document title={`${letter.name} cover letter`} author={letter.name}>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.name}>{letter.name}</Text>
        {letter.contactLine ? <Text style={styles.contact}>{letter.contactLine}</Text> : null}
        <View style={styles.meta}>
          <Text>{letter.date}</Text>
          {letter.company ? <Text>{letter.company}</Text> : null}
        </View>
        {paragraphs.map((paragraph, i) => (
          <Text key={i} style={styles.paragraph}>
            {paragraph}
          </Text>
        ))}
      </Page>
    </Document>
  );
}

export async function renderCoverLetterPdf(letter: LetterInfo): Promise<ArrayBuffer> {
  const mod = await import('@react-pdf/renderer');
  const doc = <CoverLetterPdf letter={letter} />;
  if (typeof (mod as { renderToBuffer?: unknown }).renderToBuffer === 'function') {
    const buffer = await (
      mod as unknown as { renderToBuffer: (d: React.ReactElement) => Promise<Uint8Array> }
    ).renderToBuffer(doc);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  }
  const blob = await mod.pdf(doc).toBlob();
  return blob.arrayBuffer();
}
