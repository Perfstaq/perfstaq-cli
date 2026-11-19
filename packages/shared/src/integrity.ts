import type { ScanPayload, UnsignedScanPayload } from './types.js';

/**
 * Canonical JSON: object keys sorted recursively, no whitespace, undefined dropped.
 * Same value -> same string on every runtime.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalize(v))).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
}

/** SHA-256 hex via Web Crypto (Node 18+, browsers, edge runtimes). */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function stripHash(payload: UnsignedScanPayload | ScanPayload): UnsignedScanPayload {
  const { integrityHash: _ignored, ...rest } = payload as ScanPayload;
  return rest;
}

/**
 * integrityHash = SHA-256( canonical(payload without hash) | cliVersion | machineFingerprint ).
 *
 * The machine fingerprint is itself SHA-256(local salt); the salt stays on the machine.
 * This makes the payload tamper-evident (edit any score and the hash breaks) and ties it
 * to one machine + CLI version. It is not a proof that the scores came from real git
 * history — a modified CLI could sign fake numbers.
 */
export async function computeIntegrityHash(payload: UnsignedScanPayload | ScanPayload): Promise<string> {
  const unsigned = stripHash(payload);
  return sha256Hex(`${canonicalize(unsigned)}|${unsigned.cliVersion}|${unsigned.machineFingerprint}`);
}

export async function signPayload(payload: UnsignedScanPayload): Promise<ScanPayload> {
  return { ...payload, integrityHash: await computeIntegrityHash(payload) };
}

export async function verifyIntegrity(payload: ScanPayload): Promise<boolean> {
  if (typeof payload.integrityHash !== 'string' || !/^[0-9a-f]{64}$/.test(payload.integrityHash)) return false;
  return (await computeIntegrityHash(payload)) === payload.integrityHash;
}
