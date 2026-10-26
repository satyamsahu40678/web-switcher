export type Session = { authenticated: boolean; username: string | null; roles: string[]; csrfToken: string; csrfHeader: string; demo: boolean; loginUrl?: string };
export type Candidate = { id: string; familyId: string | null; sourceHost: string; proposedOrigin: string; reason: string; state: string; version: number; createdAt: string };
export type Audit = { id: string; actor: string; action: string; entityId: string; detail: string; createdAt: string };
export type Release = { sequence: number; digest: string; issuedAt: string; expiresAt: string; publisher: string };
export type Lookup = { status: string; familyId?: string; destinationOrigin?: string; trustClass?: string; catalogSequence?: number; requiresConfirmation?: boolean };
let csrf: { token: string; header: string } | null = null;
export function rememberCsrf(session: Session) { csrf = { token: session.csrfToken, header: session.csrfHeader }; }
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof URLSearchParams)) headers.set('Content-Type', 'application/json');
  if (csrf && init.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method)) headers.set(csrf.header, csrf.token);
  let response: Response;
  try { response = await fetch(path, { ...init, headers, credentials: 'same-origin' }); }
  catch { throw new Error('The registry is unavailable. Your local extension mappings are unaffected.'); }
  const data = response.headers.get('content-type')?.includes('json') ? await response.json().catch(() => null) : await response.text();
  if (!response.ok) throw new Error(data?.detail || `The request failed (${response.status}). Please try again.`);
  return data as T;
}
export function normalizeHost(value: string) {
  const input = value.trim();
  if (!input || input.length > 253 || /[\s/:?#@\\]/.test(input)) throw new Error('Enter a hostname only, such as old.example. Leave out https://, paths, and query strings.');
  const url = new URL(`https://${input}`);
  if (!url.hostname.includes('.') || url.hostname.startsWith('.') || url.hostname.endsWith('.')) throw new Error('Please enter a complete hostname.');
  return url.hostname;
}
