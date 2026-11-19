import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sha256Hex } from '@perfstaq/shared';

/** Random per-machine salt; only its SHA-256 ever leaves the machine. */
export async function machineFingerprint(): Promise<string> {
  const dir = join(homedir(), '.perfstaq');
  const file = join(dir, 'salt');
  let salt: string | null = null;
  try {
    salt = (await readFile(file, 'utf8')).trim();
    if (!salt) salt = null;
  } catch {
    salt = null;
  }
  if (!salt) {
    salt = randomBytes(32).toString('hex');
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(file, salt + '\n', { mode: 0o600 });
      await chmod(file, 0o600).catch(() => undefined);
    } catch {
      // Unwritable home: fingerprint is per-run only.
    }
  }
  return sha256Hex(salt);
}
