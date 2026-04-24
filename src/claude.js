const { getDb, logAudit } = require('./db');
const { getEvaluator } = require('./evaluators');

/**
 * Send a prompt to the configured AI provider and return the raw response.
 * Provider is selected via AI_PROVIDER (claude-cli, anthropic, openai, ollama, gemini).
 */
async function invokeAI(prompt) {
  const evaluator = getEvaluator();
  return evaluator.evaluate(prompt);
}

/**
 * Build the evaluation prompt for Claude based on incident type and policies.
 */
function buildEvaluationPrompt(incident, policies, mode, priorContext, categoryInfo) {
  // Render the rich markdown content if available, otherwise fall back to the one-line description.
  const policyText = policies.length > 0
    ? policies
        .map(p => {
          const header = `## ${p.rule_name}${p.auto_action ? ` (action: ${p.auto_action})` : ''}`;
          const body = p.content_md?.trim() || p.rule_description;
          return `${header}\n${body}`;
        })
        .join('\n\n---\n\n')
    : '(No specific policies defined for this category.)';

  const categoryLine = categoryInfo
    ? `${incident.type} — ${categoryInfo.label}${categoryInfo.description ? ` (${categoryInfo.description})` : ''}`
    : incident.type;

  // If the admin (or you) has evaluated this before, or admins have left context notes,
  // render them so Claude can factor them into the new recommendation.
  let priorSection = '';
  if (priorContext && priorContext.length > 0) {
    priorSection = `\n\nPRIOR CONTEXT (previous evaluations and admin notes, oldest first):\n`;
    priorSection += priorContext.map(c => `- [${c.actor} @ ${c.time}] ${c.text}`).join('\n');
    priorSection += `\n\nThis is a RE-EVALUATION. The admin has added context or wants you to reconsider. ` +
      `Incorporate the prior context into your new recommendation. If admin notes contain ` +
      `specific details (a failing domain, a symptom narrowing, a correction to your earlier ` +
      `assumption), treat those as authoritative unless they conflict with policy.`;
  }

  return `You are a home network incident manager. Evaluate the following incident and provide a recommendation.

INCIDENT:
- ID: ${incident.id}
- Title: ${incident.title}
- Description: ${incident.description || 'No description provided'}
- Type: ${categoryLine}
- Severity: ${incident.severity}
- Urgency: ${incident.urgency}
- Category: ${incident.category}
- Submitted by: ${incident.submitted_by}
- Created: ${incident.created_at}

POLICIES FOR ${incident.type.toUpperCase()}:
${policyText}

CURRENT MODE: ${mode}
${mode === 'auto' ? 'You may recommend auto-resolution if confidence is high enough.' : 'All actions require admin approval.'}
${priorSection}

INSTRUCTIONS:
Analyze this incident and respond with ONLY a valid JSON object (no markdown, no code fences) in this exact format:
{
  "recommended_action": "brief description of what should be done",
  "severity_assessment": "low|medium|high|critical",
  "can_auto_resolve": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "explanation of your analysis and why you recommend this action",
  "action_type": "whitelist|blacklist|restart|diagnose|escalate|deny|info_only",
  "action_params": {}
}

For pi-hole incidents, action_params should include the domain if identifiable.
For plex incidents, include media details if identifiable.
For network incidents, include target hosts or services to check.
Be conservative - when in doubt, escalate to admin.`;
}

/**
 * Fetch prior recommendations + admin comments so Claude can see them on re-evaluation.
 */
function collectPriorContext(db, incident) {
  const context = [];

  if (incident.claude_recommendation) {
    const reasoning = incident.claude_reasoning ? `\n  Reasoning: ${incident.claude_reasoning}` : '';
    const confidence = incident.claude_confidence != null ? ` (confidence ${Math.round(incident.claude_confidence * 100)}%)` : '';
    context.push({
      actor: 'Claude (previous eval)',
      time: incident.updated_at,
      text: `Prior recommendation${confidence}: ${incident.claude_recommendation}${reasoning}`,
    });
  }

  const comments = db.prepare(
    `SELECT actor, created_at, details FROM audit_log
     WHERE incident_id = ? AND action = 'comment'
     ORDER BY created_at ASC`
  ).all(incident.id);

  for (const c of comments) {
    context.push({
      actor: c.actor,
      time: c.created_at,
      text: c.details,
    });
  }

  return context;
}

/**
 * Evaluate a new incident using Claude.
 */
async function evaluateIncident(incident) {
  const db = getDb();

  // Update status to evaluating
  db.prepare("UPDATE incidents SET status = 'evaluating', updated_at = datetime('now') WHERE id = ?")
    .run(incident.id);
  logAudit(incident.id, 'evaluation_started', 'claude', 'Claude is evaluating this incident');

  try {
    // Get policies for this incident type
    const policies = db.prepare(
      'SELECT * FROM policies WHERE incident_type = ? AND enabled = 1'
    ).all(incident.type);

    // Get mode setting
    const modeSetting = db.prepare('SELECT value FROM settings WHERE key = ?')
      .get(`mode_${incident.type}`);
    const mode = modeSetting ? modeSetting.value : 'recommend';

    // Collect prior Claude recommendations + admin comments so Claude can factor them in
    const priorContext = collectPriorContext(db, incident);

    // Look up the category's display metadata for a richer prompt
    const categoryInfo = db.prepare('SELECT key, label, description FROM categories WHERE key = ?').get(incident.type);

    // Build and send prompt to the configured AI provider
    const prompt = buildEvaluationPrompt(incident, policies, mode, priorContext, categoryInfo);
    const response = await invokeAI(prompt);

    // Parse Claude's response
    let evaluation;
    try {
      evaluation = JSON.parse(response);
    } catch (parseErr) {
      // Try to extract JSON from response if it has extra text
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        evaluation = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error(`Could not parse Claude response as JSON: ${response.substring(0, 200)}`);
      }
    }

    // Store evaluation results (including action_type and action_params for later execution)
    db.prepare(`
      UPDATE incidents SET
        claude_recommendation = ?,
        claude_reasoning = ?,
        claude_confidence = ?,
        claude_action_type = ?,
        claude_action_params = ?,
        severity = ?,
        updated_at = datetime('now'),
        status = ?
      WHERE id = ?
    `).run(
      evaluation.recommended_action,
      evaluation.reasoning,
      evaluation.confidence,
      evaluation.action_type || null,
      evaluation.action_params ? JSON.stringify(evaluation.action_params) : null,
      evaluation.severity_assessment,
      (mode === 'auto' && evaluation.can_auto_resolve && evaluation.confidence >= 0.8)
        ? 'approved'
        : 'recommended',
      incident.id
    );

    logAudit(
      incident.id,
      'evaluation_complete',
      'claude',
      JSON.stringify(evaluation)
    );

    // If auto mode approved it, execute immediately (but don't conflate execution failures with evaluation failures)
    if (mode === 'auto' && evaluation.can_auto_resolve && evaluation.confidence >= 0.8) {
      logAudit(incident.id, 'auto_approved', 'claude', `Auto-approved with confidence ${evaluation.confidence}`);
      try {
        await executeAction(incident, evaluation);
      } catch (execErr) {
        // executeAction already logged action_failed and updated the incident status.
        // Swallow here so it doesn't cascade into an (incorrect) evaluation_failed entry.
        console.error('Auto-execution failed:', execErr.message);
      }
    }

    // Dispatch the right admin notification based on the final state after evaluation/execution
    const notifications = require('./notifications');
    const updatedIncident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incident.id);
    try {
      if (updatedIncident.status === 'recommended') {
        await notifications.notifyRecommendation(updatedIncident, evaluation);
      } else if (updatedIncident.status === 'resolved') {
        // Auto mode + successful action = resolved. Notify both admin (informational) and user.
        await notifications.notifyAutoResolved(updatedIncident);
        await notifications.notifyUserResolved(updatedIncident);
      } else if (updatedIncident.status === 'escalated') {
        await notifications.notifyEscalation(updatedIncident);
      }
    } catch (err) {
      console.error('Notification dispatch failed:', err.message);
    }

    return evaluation;
  } catch (err) {
    // Real evaluation failure (Claude CLI error, JSON parse failure, etc.)
    db.prepare(`
      UPDATE incidents SET
        status = 'escalated',
        claude_reasoning = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(`Evaluation failed: ${err.message}`, incident.id);

    logAudit(incident.id, 'evaluation_failed', 'claude', err.message);
    throw err;
  }
}

/**
 * Execute an approved action by delegating to the appropriate service module.
 */
async function executeAction(incident, evaluation) {
  const db = getDb();

  db.prepare("UPDATE incidents SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?")
    .run(incident.id);
  logAudit(incident.id, 'action_started', 'system', `Executing: ${evaluation.recommended_action}`);

  try {
    const services = require('./services');
    const service = services.serviceFor(incident);
    const result = await service.act(incident, evaluation);

    // If the service reports failure, treat it as escalation rather than resolution
    const newStatus = result.success === false ? 'escalated' : 'resolved';
    const resolvedAtClause = newStatus === 'resolved' ? ", resolved_at = datetime('now')" : '';

    db.prepare(`
      UPDATE incidents SET
        status = '${newStatus}',
        resolution_notes = ?
        ${resolvedAtClause},
        updated_at = datetime('now')
      WHERE id = ?
    `).run(result.summary || evaluation.recommended_action, incident.id);

    logAudit(incident.id, newStatus, 'system', JSON.stringify(result));

    const notifications = require('./notifications');
    const updatedIncident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incident.id);
    try {
      if (newStatus === 'resolved') {
        await notifications.notifyUserResolved(updatedIncident);
      } else {
        // Execution returned success:false — escalation
        await notifications.notifyEscalation(updatedIncident);
      }
    } catch (err) {
      console.error('Notification dispatch failed:', err.message);
    }

    return result;
  } catch (err) {
    db.prepare(`
      UPDATE incidents SET
        status = 'escalated',
        resolution_notes = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(`Action failed: ${err.message}`, incident.id);

    logAudit(incident.id, 'action_failed', 'system', err.message);

    // Notify admin of failure
    try {
      const notifications = require('./notifications');
      const updatedIncident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incident.id);
      await notifications.notifyActionFailed(updatedIncident, err.message);
    } catch (notifyErr) {
      console.error('Failure notification failed:', notifyErr.message);
    }

    throw err;
  }
}

/**
 * Called when admin approves a recommendation.
 */
async function executeApproved(incident) {
  const db = getDb();
  const current = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incident.id);

  let action_params = {};
  if (current.claude_action_params) {
    try { action_params = JSON.parse(current.claude_action_params); } catch {}
  }

  const evaluation = {
    recommended_action: current.claude_recommendation,
    reasoning: current.claude_reasoning,
    confidence: current.claude_confidence,
    action_type: current.claude_action_type,
    action_params,
  };

  return executeAction(current, evaluation);
}

module.exports = { invokeAI, evaluateIncident, executeApproved };
