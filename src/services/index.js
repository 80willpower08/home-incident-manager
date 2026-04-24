const { getDb } = require('../db');

const pihole = require('./pihole');
const plex = require('./plex');
const blueiris = require('./blueiris');
const network = require('./network');

// Generic handler for categories without a dedicated service module
const generic = {
  async diagnose(incident) {
    return { summary: 'No automated diagnostics available for this category. Escalated to admin.', data: {} };
  },
  async act(incident, evaluation) {
    return { summary: 'No automated action available for this category — manual intervention required.', success: false };
  },
};

const MODULES = { pihole, plex, blueiris, network };

/**
 * Look up the appropriate service module for an incident based on its
 * category's `service_module` column. Falls back to generic.
 */
function serviceFor(incident) {
  const cat = getDb().prepare('SELECT service_module FROM categories WHERE key = ?').get(incident.type);
  const moduleName = cat?.service_module;
  return (moduleName && MODULES[moduleName]) || generic;
}

module.exports = {
  serviceFor,
  generic,
  MODULES,
  pihole,
  plex,
  blueiris,
  network,
};
