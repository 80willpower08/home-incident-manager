// Pi-hole v6 REST API integration
// v6 uses session-based auth via POST /api/auth with a password,
// returning an SID that authenticates subsequent requests.

const PIHOLE_URL = process.env.PIHOLE_URL;
const PIHOLE_PASSWORD = process.env.PIHOLE_PASSWORD || process.env.PIHOLE_API_KEY;

function requireConfig() {
  if (!PIHOLE_URL || !PIHOLE_PASSWORD) {
    throw new Error('Pi-hole not configured. Set PIHOLE_URL and PIHOLE_PASSWORD env vars to enable Pi-hole actions.');
  }
}

function isConfigured() {
  return !!(PIHOLE_URL && PIHOLE_PASSWORD);
}

let sessionCache = { sid: null, expiresAt: 0 };

/**
 * Get a valid SID, reusing cached session if still valid.
 */
async function getSid() {
  requireConfig();
  const now = Date.now();
  if (sessionCache.sid && sessionCache.expiresAt > now + 10_000) {
    return sessionCache.sid;
  }

  const res = await fetch(`${PIHOLE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PIHOLE_PASSWORD }),
  });

  if (!res.ok) {
    throw new Error(`Pi-hole auth failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  if (!data.session?.valid) {
    throw new Error(`Pi-hole auth invalid: ${JSON.stringify(data)}`);
  }

  sessionCache = {
    sid: data.session.sid,
    expiresAt: now + (data.session.validity * 1000),
  };
  return sessionCache.sid;
}

/**
 * Call a Pi-hole v6 API endpoint with SID auth.
 */
async function piholeApi(path, { method = 'GET', body } = {}) {
  const sid = await getSid();
  const res = await fetch(`${PIHOLE_URL}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-FTL-SID': sid,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Pi-hole API ${method} ${path} failed: ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

/**
 * Check if a domain is in an allow or deny list.
 * Returns { allowed: [...], denied: [...] } matching entries.
 */
async function lookupDomain(domain) {
  const result = { allowed: [], denied: [], blockedByList: false };
  try {
    const exact = await piholeApi(`/domains/exact/${encodeURIComponent(domain)}`);
    const all = exact?.domains || [];
    result.allowed = all.filter(d => d.type === 'allow');
    result.denied = all.filter(d => d.type === 'deny');
    result.blockedByList = result.denied.length > 0;
  } catch (err) {
    result.error = err.message;
  }
  return result;
}

/**
 * Recent queries log (for finding what's been blocked recently).
 */
async function getRecentQueries(count = 20) {
  return piholeApi(`/queries?length=${count}`);
}

/**
 * Diagnose a Pi-hole incident.
 */
async function diagnose(incident) {
  const results = { summary: '', checked: [] };

  try {
    const domainMatch = (incident.description || incident.title || '').match(
      /(?:https?:\/\/)?([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)+)/
    );

    if (domainMatch) {
      const domain = domainMatch[1];
      const lookup = await lookupDomain(domain);
      results.checked.push({ domain, ...lookup });
      results.summary = lookup.blockedByList
        ? `Domain ${domain} is currently in deny list.`
        : `Domain ${domain} not found in explicit allow/deny lists (may be blocked by a blocklist).`;
    } else {
      const recent = await getRecentQueries(20);
      results.recentQueries = recent?.queries?.slice(0, 20) || [];
      results.summary = `Retrieved ${results.recentQueries.length} recent queries for review.`;
    }
  } catch (err) {
    results.summary = `Diagnosis failed: ${err.message}`;
    results.error = err.message;
  }

  return results;
}

/**
 * Add a domain to the allow list (exact match).
 */
async function addToAllowList(domain, comment = 'Added by Incident Manager') {
  return piholeApi('/domains/allow/exact', {
    method: 'POST',
    body: { domain, comment, groups: [0], enabled: true },
  });
}

/**
 * Add a domain to the deny list (exact match).
 */
async function addToDenyList(domain, comment = 'Added by Incident Manager') {
  return piholeApi('/domains/deny/exact', {
    method: 'POST',
    body: { domain, comment, groups: [0], enabled: true },
  });
}

/**
 * Execute an action on Pi-hole.
 */
async function act(incident, evaluation) {
  const action = evaluation.action_type || evaluation.recommended_action;
  const params = evaluation.action_params || {};

  let domain = params.domain;
  if (!domain) {
    const match = (incident.description || incident.title || '').match(
      /(?:https?:\/\/)?([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)+)/
    );
    if (match) domain = match[1];
  }

  if (!domain) {
    return { success: false, summary: 'Could not identify domain to act on.' };
  }

  const normalized = (action || '').toLowerCase();

  if (normalized === 'whitelist' || normalized === 'unblock' || normalized === 'allow') {
    await addToAllowList(domain, `Unblock request from incident #${incident.id}`);
    return { success: true, summary: `Allowed domain: ${domain}` };
  }

  if (normalized === 'blacklist' || normalized === 'block' || normalized === 'deny') {
    await addToDenyList(domain, `Block request from incident #${incident.id}`);
    return { success: true, summary: `Denied domain: ${domain}` };
  }

  if (normalized === 'info_only' || normalized === 'diagnose') {
    const diag = await diagnose(incident);
    return { success: true, summary: diag.summary, diagnostics: diag };
  }

  return { success: false, summary: `Unknown action: ${action}` };
}

module.exports = { diagnose, act, getSid, lookupDomain, addToAllowList, addToDenyList, isConfigured };
