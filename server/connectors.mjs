import { XMLParser } from 'fast-xml-parser';
import { json, request } from './net.mjs';
import { SourceError } from './errors.mjs';
const UA = 'delta-leads/0.1.0';
const decode = (s, multiline = false) =>
  String(s ?? '')
    .replace(/<(?:br\s*\/?|\/?(?:p|div|li|blockquote))\s*>/gi, multiline ? '\n' : ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(
      /&(?:amp|lt|gt|quot|apos|#39|#x27);/g,
      (x) =>
        ({
          '&amp;': '&',
          '&lt;': '<',
          '&gt;': '>',
          '&quot;': '"',
          '&apos;': "'",
          '&#39;': "'",
          '&#x27;': "'",
        })[x],
    )
    .replace(multiline ? /[^\S\n]+/g : /\s+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
export function canonicalUrl(source, value) {
  try {
    const u = new URL(value);
    const hosts = {
      reddit: ['www.reddit.com', 'reddit.com', 'old.reddit.com'],
      x: ['x.com', 'twitter.com', 'www.x.com'],
      threads: ['www.threads.net', 'threads.net', 'www.threads.com', 'threads.com'],
    };
    if (u.protocol !== 'https:' || u.username || u.password || !hosts[source]?.includes(u.hostname))
      return null;
    u.search = '';
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}
export function normalize(source, item) {
  const url = canonicalUrl(source, item.url);
  const createdAt =
    typeof item.createdAt === 'number' ? item.createdAt : Date.parse(item.createdAt);
  if (!url || !item.id || !Number.isFinite(createdAt) || createdAt <= 0) return null;
  return {
    id: String(item.id).startsWith(source + ':')
      ? String(item.id).slice(0, 160)
      : source + ':' + String(item.id).slice(0, 150),
    source,
    url,
    title: decode(item.title).slice(0, 1000),
    text: decode(item.text, true).slice(0, 16000),
    author: decode(item.author).slice(0, 100),
    community: decode(item.community).slice(0, 100),
    createdAt,
  };
}
export function redditJson(data) {
  if (!Array.isArray(data?.data?.children)) throw new SourceError('invalid_reddit_response');
  return {
    posts: data.data.children
      .map(({ data: p }) =>
        normalize('reddit', {
          id: p.id,
          title: p.title,
          text: p.selftext,
          author: p.author,
          community: p.subreddit,
          createdAt: p.created_utc * 1000,
          url: 'https://www.reddit.com' + p.permalink,
        }),
      )
      .filter(Boolean),
    cursor: data.data.after || null,
  };
}
export function redditRss(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new SourceError('unsafe_xml');
  let doc;
  try {
    doc = new XMLParser({
      ignoreAttributes: false,
      processEntities: false,
      isArray: (name) => ['entry', 'link', 'item'].includes(name),
    }).parse(xml);
  } catch {
    throw new SourceError('invalid_rss');
  }
  const entries = doc.feed?.entry;
  if (!Array.isArray(entries)) throw new SourceError('invalid_rss');
  return {
    posts: entries
      .map((e) => {
        const links = e.link || [];
        return normalize('reddit', {
          id: String(e.id || '').replace(/^t3_/, ''),
          title: e.title,
          text: e.content?.['#text'] ?? e.content,
          author: e.author?.name,
          community: e.category?.['@_label'],
          url: links.find((l) => l['@_rel'] === 'alternate')?.['@_href'] || links[0]?.['@_href'],
          createdAt: e.published || e.updated,
        });
      })
      .filter(Boolean),
    cursor: null,
  };
}
export class RedditConnector {
  constructor(fetcher = fetch) {
    this.fetcher = fetcher;
    this.token = null;
    this.tokenKey = '';
  }
  async access(s) {
    const key = JSON.stringify([s.redditClientId, s.redditClientSecret, s.redditRefreshToken]);
    if (this.tokenKey === key && this.token?.expiresAt > Date.now() + 60000)
      return this.token.value;
    const body = new URLSearchParams(
      s.redditRefreshToken
        ? { grant_type: 'refresh_token', refresh_token: s.redditRefreshToken }
        : { grant_type: 'client_credentials' },
    );
    const data = await json('https://www.reddit.com/api/v1/access_token', {
      fetcher: this.fetcher,
      method: 'POST',
      headers: {
        authorization:
          'Basic ' + Buffer.from(s.redditClientId + ':' + s.redditClientSecret).toString('base64'),
        'user-agent': s.redditUserAgent,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!data.access_token) throw new SourceError('reddit_oauth_failed');
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    };
    this.tokenKey = key;
    return this.token.value;
  }
  async search(query, s, { cursor } = {}) {
    const mode = s.redditMode,
      root = mode === 'oauth' ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
    const subs = s.subreddits
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    const path =
      (subs.length ? '/r/' + subs.join('+') : '') +
      '/search' +
      (mode === 'rss' ? '.rss' : mode === 'json' ? '.json' : '');
    const u = new URL(root + path);
    u.search = new URLSearchParams({
      q: query,
      sort: 'new',
      t: s.freshnessHours <= 24 ? 'day' : 'week',
      limit: '100',
      ...(subs.length ? { restrict_sr: 'on' } : {}),
      ...(cursor ? { after: cursor } : {}),
    });
    const headers = { 'user-agent': s.redditUserAgent };
    if (mode === 'oauth') headers.authorization = 'Bearer ' + (await this.access(s));
    if (mode === 'rss') return redditRss(await request(u, { fetcher: this.fetcher, headers }));
    return redditJson(await json(u, { fetcher: this.fetcher, headers }));
  }
}
export class XConnector {
  constructor(fetcher = fetch) {
    this.fetcher = fetcher;
  }
  async search(query, s, { cursor, now = Date.now() } = {}) {
    const u = new URL('https://api.x.com/2/tweets/search/recent');
    u.search = new URLSearchParams({
      query: query + ' -is:retweet',
      'tweet.fields': 'created_at,author_id,lang',
      max_results: '100',
      start_time: new Date(
        now - Math.min(s.freshnessHours * 3600000, 7 * 86400000 - 60000),
      ).toISOString(),
      ...(cursor ? { next_token: cursor } : {}),
    });
    const data = await json(u, {
      fetcher: this.fetcher,
      headers: { authorization: 'Bearer ' + s.xBearerToken, 'user-agent': UA },
    });
    if (data.errors?.length && !data.data) throw new SourceError('x_api_error');
    return {
      posts: (data.data || [])
        .map((p) =>
          normalize('x', {
            id: p.id,
            title: p.text,
            text: '',
            author: p.author_id,
            createdAt: p.created_at,
            url: 'https://x.com/i/status/' + p.id,
          }),
        )
        .filter(Boolean),
      cursor: data.meta?.next_token || null,
    };
  }
}
export class ThreadsConnector {
  constructor(fetcher = fetch) {
    this.fetcher = fetcher;
  }
  async search(query, s, { cursor } = {}) {
    const u = new URL('https://graph.threads.net/v1.0/keyword_search');
    u.search = new URLSearchParams({
      q: query,
      search_type: 'RECENT',
      search_mode: 'KEYWORD',
      fields: 'id,text,permalink,timestamp,username',
      limit: '100',
      ...(cursor ? { after: cursor } : {}),
    });
    const data = await json(u, {
      fetcher: this.fetcher,
      headers: { authorization: 'Bearer ' + s.threadsAccessToken, 'user-agent': UA },
    });
    if (data.error) throw new SourceError('threads_api_error');
    return {
      posts: (data.data || [])
        .map((p) =>
          normalize('threads', {
            id: p.id,
            title: p.text,
            text: '',
            author: p.username,
            createdAt: p.timestamp,
            url: p.permalink,
          }),
        )
        .filter(Boolean),
      cursor: data.paging?.next ? data.paging?.cursors?.after : null,
    };
  }
}
export const createConnectors = (fetcher = fetch) => ({
  reddit: new RedditConnector(fetcher),
  x: new XConnector(fetcher),
  threads: new ThreadsConnector(fetcher),
});
