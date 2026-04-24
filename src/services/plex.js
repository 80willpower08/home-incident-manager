const PLEX_URL = process.env.PLEX_URL;
const PLEX_TOKEN = process.env.PLEX_TOKEN;

function isConfigured() {
  return !!(PLEX_URL && PLEX_TOKEN);
}

function requireConfig() {
  if (!isConfigured()) {
    throw new Error('Plex not configured. Set PLEX_URL and PLEX_TOKEN env vars to enable Plex actions.');
  }
}

/**
 * Query Plex API.
 */
async function plexApi(endpoint) {
  requireConfig();
  const url = `${PLEX_URL}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'X-Plex-Token': PLEX_TOKEN,
      'Accept': 'application/json',
    },
  });
  if (!response.ok) throw new Error(`Plex API error: ${response.status}`);
  return response.json();
}

/**
 * Get current active sessions.
 */
async function getActiveSessions() {
  const data = await plexApi('/status/sessions');
  return data.MediaContainer || {};
}

/**
 * Get server info and health.
 */
async function getServerInfo() {
  return plexApi('/');
}

/**
 * Diagnose Plex issues - check sessions, transcode status, etc.
 */
async function diagnose(incident) {
  const results = { summary: '', sessions: [], serverHealth: null };

  try {
    const [sessions, serverInfo] = await Promise.all([
      getActiveSessions(),
      getServerInfo(),
    ]);

    results.sessions = sessions.Metadata || [];
    results.serverHealth = serverInfo.MediaContainer;
    results.activeSessionCount = sessions.size || 0;

    // Check for subtitle/audio issues in active sessions
    const sessionDetails = results.sessions.map(s => ({
      title: s.title,
      type: s.type,
      player: s.Player?.title,
      transcodeDecision: s.TranscodeSession?.videoDecision,
      audioDecision: s.TranscodeSession?.audioDecision,
      subtitleDecision: s.TranscodeSession?.subtitleDecision,
      streamBitrate: s.Session?.bandwidth,
    }));

    results.sessionDetails = sessionDetails;
    results.summary = `Server online. ${results.activeSessionCount} active sessions. ${sessionDetails.length > 0 ? 'Session details collected.' : 'No active streams.'}`;
  } catch (err) {
    results.summary = `Plex diagnosis failed: ${err.message}`;
    results.error = err.message;
  }

  return results;
}

/**
 * Execute an action on Plex.
 */
async function act(incident, evaluation) {
  const action = evaluation.action_type || 'diagnose';

  if (action === 'restart') {
    // Note: Plex doesn't have a direct restart API — this would need system-level access
    return {
      success: false,
      summary: 'Plex restart requires system-level access. Diagnostics collected for admin review.',
      diagnostics: await diagnose(incident),
    };
  }

  if (action === 'diagnose' || action === 'info_only') {
    const diag = await diagnose(incident);
    return {
      success: true,
      summary: `Diagnostics collected: ${diag.summary}`,
      diagnostics: diag,
    };
  }

  return { success: false, summary: `Action "${action}" not implemented for Plex.` };
}

module.exports = { diagnose, act, isConfigured };
