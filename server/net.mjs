import { SourceError } from './errors.mjs';
export async function request(
  url,
  {
    fetcher = fetch,
    timeout = 15000,
    maxBytes = 2 * 1024 * 1024,
    allowHttpError = false,
    onResponse,
    ...options
  } = {},
) {
  let response;
  try {
    response = await fetcher(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new SourceError('network_error');
  }
  onResponse?.(response);
  if (!response.ok && !allowHttpError) {
    await response.body?.cancel();
    const raw = response.headers.get('retry-after');
    const retryAfter = /^\d+$/.test(raw || '')
      ? Number(raw) * 1000
      : Math.max(0, Date.parse(raw) - Date.now()) || 0;
    throw new SourceError('http_' + response.status, {
      retryAfter: Math.min(86400000, retryAfter),
      permanent: [400, 401, 403, 404].includes(response.status),
    });
  }
  const chunks = [];
  let bytes = 0;
  for await (const c of response.body) {
    bytes += c.length;
    if (bytes > maxBytes) {
      throw new SourceError('response_too_large');
    }
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export async function json(url, opts) {
  try {
    return JSON.parse(await request(url, opts));
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError('invalid_json');
  }
}
export function safeEndpoint(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new SourceError('invalid_endpoint');
  }
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !(
      u.protocol === 'https:' ||
      (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
    )
  )
    throw new SourceError('invalid_endpoint');
  return u.href.replace(/\/$/, '');
}
