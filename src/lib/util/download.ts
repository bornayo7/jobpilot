/**
 * Hand a blob to the browser as a download or a new tab.
 *
 * The object URL must outlive the call: revoking synchronously after
 * click()/open() races the fetch and can produce an empty tab or a cancelled
 * download. Revoke on a timer instead — long enough for the browser to have
 * read the blob, short enough not to pin a resume-sized buffer in memory.
 */
const OBJECT_URL_TTL_MS = 60_000;

export function downloadFile(blob: Blob, filename: string): void {
  lend(blob, (url) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  });
}

export function openInNewTab(blob: Blob): void {
  lend(blob, (url) => window.open(url, '_blank'));
}

function lend(blob: Blob, use: (url: string) => void): void {
  const url = URL.createObjectURL(blob);
  use(url);
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_TTL_MS);
}
