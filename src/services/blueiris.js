// BlueIris integration - placeholder until API is ready
// The user is working with another Claude instance on BlueIris monitoring

const BLUEIRIS_URL = process.env.BLUEIRIS_URL || 'http://blueiris.local:81';
const BLUEIRIS_USER = process.env.BLUEIRIS_USER || 'admin';
const BLUEIRIS_PASS = process.env.BLUEIRIS_PASS;

/**
 * Diagnose BlueIris issues.
 * TODO: Implement once BlueIris API integration is ready.
 */
async function diagnose(incident) {
  return {
    summary: 'BlueIris diagnostics not yet implemented. Incident escalated for manual review.',
    data: {},
  };
}

/**
 * Execute a BlueIris action.
 * TODO: Implement once BlueIris API integration is ready.
 */
async function act(incident, evaluation) {
  return {
    success: false,
    summary: 'BlueIris actions not yet implemented. Manual intervention required.',
  };
}

module.exports = { diagnose, act };
