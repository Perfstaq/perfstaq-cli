import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import open from 'open';
import { CLI_CALLBACK_PORT } from '@perfstaq/shared';
import { SCAN_COOLDOWN_HOURS } from '@perfstaq/shared';
import type { ScanPayload, TrustTier } from '@perfstaq/shared';

export interface AuthResult {
  token: string;
  username: string;
}

const PAGE = (msg: string) =>
  `<!doctype html><meta charset="utf-8"><title>Perfstaq</title><body style="font-family:system-ui;background:#0b0b10;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${msg}</h2><p>You can close this tab and return to your terminal.</p></div></body>`;

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        server.removeListener('error', onError);
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
      } else reject(err);
    };
    server.once('error', onError);
    server.listen(CLI_CALLBACK_PORT, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/** Browser login via a loopback callback. Resolves with the token + GitHub username. */
// First-time GitHub sign-in (consent screen, maybe 2FA) can take a few minutes.
export async function browserLogin(api: string, timeoutMs = 300_000): Promise<AuthResult> {
  const state = randomBytes(16).toString('hex');
  let done: (r: AuthResult | Error) => void = () => undefined;
  const result = new Promise<AuthResult | Error>((r) => (done = r));

  const MAX_BODY = 16 * 1024;
  const safeEqual = (x: string, y: string): boolean => {
    const bx = Buffer.from(x);
    const by = Buffer.from(y);
    return bx.length === by.length && timingSafeEqual(bx, by);
  };
  const html = (res: import('node:http').ServerResponse, code: number, msg: string) =>
    res.writeHead(code, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(PAGE(msg));

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end();
      return;
    }
    // The token must only ever arrive in the POST body, never in the URL.
    if (url.search) {
      res.writeHead(400).end();
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    let aborted = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        aborted = true;
        res.writeHead(413, { connection: 'close' }).end();
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const token = form.get('token');
      const username = form.get('username');
      const got = form.get('state') ?? '';
      if (!safeEqual(got, state) || !token || !username) {
        html(res, 400, 'Sign-in failed');
        return;
      }
      html(res, 200, 'Signed in to Perfstaq');
      done({ token, username });
    });
    req.on('error', () => undefined);
  });

  const port = await listen(server);
  const authUrl = `${api}/cli-auth?port=${port}&state=${state}`; // callback target is http://127.0.0.1:<port>/callback
  console.log(`Opening ${authUrl}`);
  // PERFSTAQ_NO_OPEN=1: don't launch a browser (CI, remote shells); open the printed URL yourself.
  if (process.env.PERFSTAQ_NO_OPEN !== '1') open(authUrl).catch(() => console.log('Could not open a browser; open the URL above manually.'));

  const timer = setTimeout(() => done(new Error('Timed out waiting for browser sign-in (5 min).')), timeoutMs);
  const r = await result;
  clearTimeout(timer);
  server.close();
  server.closeAllConnections?.();
  if (r instanceof Error) throw r;
  return r;
}

export interface UploadResponse {
  profileUrl?: string;
  globalRank?: number | null;
  overallScore?: number;
  trustTier?: TrustTier;
  flags?: string[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string; message?: string };
    return j.error ?? j.message ?? '';
  } catch {
    return '';
  }
}

function failure(prefix: string, res: Response, detail: string): ApiError {
  const hint =
    res.status === 401
      ? ' (sign-in expired; run the scan again)'
      : res.status === 429
        ? ` (cooldown: Perfstaq accepts one scan per ${SCAN_COOLDOWN_HOURS} hours; try again later)`
        : '';
  return new ApiError(`${prefix}: HTTP ${res.status}${hint}${detail ? ` - ${detail}` : ''}`, res.status);
}

async function post(api: string, path: string, token: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(`${api}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new Error(`Could not reach ${api}: ${(e as Error).message}`);
  }
}

/** One-time nonce that binds an evidence upload to this sign-in. */
export async function fetchNonce(api: string, token: string): Promise<{ nonce: string; expiresAt: string }> {
  const res = await post(api, '/api/scans/nonce', token);
  if (!res.ok) throw failure('Could not get a verification nonce', res, await errorDetail(res));
  const j = (await res.json()) as { nonce?: string; expiresAt?: string };
  if (!j.nonce) throw new Error('Server returned no nonce.');
  return { nonce: j.nonce, expiresAt: j.expiresAt ?? '' };
}

export async function uploadScan(api: string, token: string, payload: ScanPayload): Promise<UploadResponse> {
  const res = await post(api, '/api/scans', token, payload);
  if (!res.ok) throw failure('Upload failed', res, await errorDetail(res));
  return (await res.json()) as UploadResponse;
}
