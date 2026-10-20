'use strict';

/**
 * Which Strata requests may carry the API key, and which addresses may be fetched at all. (#6)
 *
 * `strata:metrics`, `strata:health` and the diagnostics `/health` + `/v1/models` fetches all take a
 * base URL the renderer supplied, and all three attach `Authorization: Bearer <key>` taken from
 * `STRATAPILOT_KEY` / `STRATA_API_KEY`. The only validation was the protocol, and `http:` was
 * accepted - so one injection point in the renderer could point the app at a host of an attacker's
 * choosing and read the key off the wire in clear text, then persist that host in `strataUrls` so
 * the key keeps going there on every later poll.
 *
 * The rule: the key travels only to an address the user actually configured
 * (`settings.strataUrl` / `settings.strataUrls`) or to a local / LAN address, which is what a Strata
 * server is. Anything else is fetched WITHOUT the key and the log says so. And `http:` is refused
 * for a non-local host outright - a key over plain HTTP is a key on the wire.
 *
 * Pure helpers so the decision can be tested without Electron or a server.
 */

/** Strip the trailing slash / `/v1` the app accepts in a Strata address. */
function normalizeBaseUrl(value) {
  return String(value == null ? '' : value).trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function parseBaseUrl(value) {
  try {
    return new URL(normalizeBaseUrl(value));
  } catch {
    return null;
  }
}

/** localhost, loopback, RFC1918 and the mDNS/split-DNS names a home Strata box usually has. */
function isLocalHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (host === 'localhost' || host === '::1' || host === '::' || host === '0.0.0.0') return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/\.(local|lan|internal|home)$/.test(host)) return true;
  return false;
}

/** Protocol policy: https anywhere, http only to a local / LAN address. */
function urlPolicy(target) {
  if (!target) return { ok: false, error: 'invalid base url' };
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return { ok: false, error: 'unsupported protocol' };
  if (target.protocol === 'http:' && !isLocalHost(target.hostname)) {
    return {
      ok: false,
      error: `http:// is refused for ${target.hostname}: the request and any key would travel in clear text - use https:// for a remote server`,
    };
  }
  return { ok: true };
}

/** The addresses the user configured (the Monitor switcher already keeps this list). */
function allowlistFrom(settings) {
  const list = [];
  if (settings && settings.strataUrl) list.push(settings.strataUrl);
  if (settings && Array.isArray(settings.strataUrls)) list.push(...settings.strataUrls);
  return list.filter(Boolean);
}

/**
 * Decide whether `target` gets the key. `key` is the configured credential (may be empty).
 * Returns { key, withheld, reason } - a withheld key is fetched without it and logged, never
 * silently dropped: a wrong number nobody can see is the failure mode this repo keeps hitting.
 */
function keyForHost(target, allowlist, key) {
  if (!key) return { key: '', withheld: false, reason: '' };
  if (!target) return { key: '', withheld: true, reason: 'no target host' };
  if (isLocalHost(target.hostname)) return { key, withheld: false, reason: '' };
  for (const entry of allowlist || []) {
    const allowed = parseBaseUrl(entry);
    if (allowed && allowed.origin === target.origin) return { key, withheld: false, reason: '' };
  }
  return { key: '', withheld: true, reason: `${target.host} is neither a local address nor one of the configured servers` };
}

module.exports = { normalizeBaseUrl, parseBaseUrl, isLocalHost, urlPolicy, allowlistFrom, keyForHost };
