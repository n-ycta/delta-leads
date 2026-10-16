import { messageFor } from './localization.mjs';
import { DeltaError } from './errors.mjs';
export class DeltaClient {
  constructor(
    url = process.env.DELTA_URL || 'http://127.0.0.1:7700',
    token = process.env.DELTA_TOKEN,
  ) {
    if (!token) throw Error('DELTA_TOKEN is required; install through the node supervisor');
    this.url = url.replace(/\/$/, '').replace(/\/v1$/, '');
    this.token = token;
  }
  async request(method, path, body) {
    const response = await fetch(this.url + '/v1' + path, {
      method,
      headers: { authorization: 'Bearer ' + this.token, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(35000),
    });
    const data = await response.json();
    if (!response.ok || !data.ok)
      throw new DeltaError(data.error?.code || 'unavailable', 'Delta API request failed');
    return data.result;
  }
}
export async function serve(client, manifest, handlers, signal) {
  let session;
  const pending = new Set();
  while (!signal.aborted) {
    try {
      if (!session) session = (await client.request('POST', '/components', manifest)).session;
      const { invocation } = await client.request(
        'GET',
        `/components/${manifest.id}/next?session=${encodeURIComponent(session)}&timeout=20`,
      );
      if (!invocation) continue;
      const current = session;
      const task = (async () => {
        let reply;
        try {
          const handler = handlers[invocation.capability];
          if (!handler) throw new DeltaError('not_found', 'Unknown capability');
          reply = { ok: true, result: await handler(invocation.args || {}, invocation.caller) };
        } catch (e) {
          reply = {
            ok: false,
            error: {
              code: e.code || 'handler_error',
              message: messageFor(
                e instanceof DeltaError ? e.message : 'Plugin operation failed',
                invocation.args?._locale,
              ),
            },
          };
        }
        await client
          .request('POST', `/components/${manifest.id}/result`, {
            session: current,
            id: invocation.id,
            ...reply,
          })
          .catch(() => {});
      })();
      pending.add(task);
      task.finally(() => pending.delete(task));
    } catch (e) {
      console.error('Delta connection:', e.code || 'unavailable');
      session = undefined;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await Promise.allSettled(pending);
  if (session)
    await client
      .request('DELETE', `/components/${manifest.id}?session=${encodeURIComponent(session)}`)
      .catch(() => {});
}
