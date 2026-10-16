export class DeltaError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
export class SourceError extends Error {
  constructor(code, { retryAfter = 0, permanent = false } = {}) {
    super(code);
    this.code = code;
    this.retryAfter = retryAfter;
    this.permanent = permanent;
  }
}
export const bad = (message) => {
  throw new DeltaError('bad_request', message);
};
export const safeError = (e) =>
  /^[a-z_0-9-]{1,60}$/i.test(e?.code || '') ? e.code : 'request_failed';
