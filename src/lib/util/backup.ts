import { arrayBufferToBase64, base64ToUint8Array } from './base64';

/**
 * Encrypted full backup: PBKDF2-SHA256 (310k iterations) derives an AES-GCM
 * key from the passphrase; the payload (profiles, settings, answers, tracker,
 * versions, document blobs, mapping cache) travels as one .jpbak JSON file.
 * WebCrypto only — no dependencies. Pure pack/unpack here; gathering/restoring
 * store contents lives with the UI so this stays unit-testable.
 */
const PBKDF2_ITERATIONS = 310_000;

export interface BackupEnvelope {
  format: 'jobpilot-backup';
  version: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; saltB64: string };
  cipher: { name: 'AES-GCM'; ivB64: string };
  payloadB64: string;
}

export async function encryptBackup(payload: unknown, passphrase: string): Promise<BackupEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    format: 'jobpilot-backup',
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, saltB64: arrayBufferToBase64(salt.buffer) },
    cipher: { name: 'AES-GCM', ivB64: arrayBufferToBase64(iv.buffer) },
    payloadB64: arrayBufferToBase64(ciphertext),
  };
}

export async function decryptBackup(envelope: BackupEnvelope, passphrase: string): Promise<unknown> {
  if (envelope.format !== 'jobpilot-backup' || envelope.version !== 1) {
    throw new Error('Not a JobPilot backup file');
  }
  const salt = base64ToUint8Array(envelope.kdf.saltB64);
  const iv = base64ToUint8Array(envelope.cipher.ivB64);
  const key = await deriveKey(passphrase, salt, envelope.kdf.iterations);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      base64ToUint8Array(envelope.payloadB64),
    );
  } catch {
    throw new Error('Wrong passphrase (or corrupted file)');
  }
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
