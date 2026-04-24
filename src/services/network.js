const { exec } = require('child_process');

/**
 * Run a shell command and return output.
 */
function runCommand(cmd, timeout = 10000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout }, (error, stdout, stderr) => {
      if (error && !stdout) {
        reject(new Error(`Command failed: ${error.message}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Ping a host.
 */
async function ping(host, count = 4) {
  const output = await runCommand(`ping -c ${count} -W 3 ${host}`);
  // Parse packet loss
  const lossMatch = output.match(/(\d+)% packet loss/);
  const rttMatch = output.match(/= ([\d.]+)\/([\d.]+)\/([\d.]+)/);
  return {
    host,
    output,
    packetLoss: lossMatch ? parseInt(lossMatch[1]) : null,
    avgRtt: rttMatch ? parseFloat(rttMatch[2]) : null,
  };
}

/**
 * DNS lookup.
 */
async function dnsLookup(domain) {
  const output = await runCommand(`nslookup ${domain}`);
  return { domain, output };
}

/**
 * Traceroute to host.
 */
async function traceroute(host) {
  const output = await runCommand(`traceroute -m 15 -w 3 ${host}`, 30000);
  return { host, output };
}

/**
 * Diagnose network issues.
 */
async function diagnose(incident) {
  const results = { summary: '', tests: [] };

  try {
    // Default targets if none specified
    const targets = ['8.8.8.8', '1.1.1.1', 'google.com'];

    // Extract any hosts/IPs from description
    const hostMatch = (incident.description || '').match(
      /(?:https?:\/\/)?([a-zA-Z0-9][-a-zA-Z0-9.]*\.[a-zA-Z]{2,}|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g
    );
    if (hostMatch) {
      targets.unshift(...hostMatch.map(h => h.replace(/^https?:\/\//, '')));
    }

    // Run pings in parallel
    const pingResults = await Promise.all(
      [...new Set(targets)].slice(0, 5).map(t => ping(t).catch(err => ({ host: t, error: err.message })))
    );

    results.tests = pingResults;

    // Check gateway
    try {
      const gateway = await runCommand("ip route | grep default | awk '{print $3}'");
      if (gateway) {
        const gatewayPing = await ping(gateway, 2);
        results.gateway = { address: gateway, ...gatewayPing };
      }
    } catch (err) {
      results.gateway = { error: err.message };
    }

    const failedPings = pingResults.filter(r => r.error || (r.packetLoss && r.packetLoss > 50));
    if (failedPings.length === 0) {
      results.summary = 'All connectivity tests passed. Network appears healthy.';
    } else if (failedPings.length === pingResults.length) {
      results.summary = 'All connectivity tests failed. Possible network outage.';
    } else {
      results.summary = `Partial connectivity issues. ${failedPings.length}/${pingResults.length} targets unreachable.`;
    }
  } catch (err) {
    results.summary = `Network diagnosis failed: ${err.message}`;
    results.error = err.message;
  }

  return results;
}

/**
 * Execute a network action.
 */
async function act(incident, evaluation) {
  // Network issues are primarily diagnostic
  const diag = await diagnose(incident);
  return {
    success: true,
    summary: `Network diagnostics: ${diag.summary}`,
    diagnostics: diag,
  };
}

module.exports = { diagnose, act, ping, dnsLookup, traceroute };
