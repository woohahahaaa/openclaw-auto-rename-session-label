const fs = require('fs');
const os = require('os');
const path = require('path');
const { glob } = require('fs/promises');

// ============================================================================
// auto-session-label - Unified OpenClaw hook for both ClawHub and SkillHub
// ============================================================================

const MAX_LABEL_LEN = 50;      // fallback truncation length
const TITLE_MAX_LEN = 30;      // LLM title hard cap
const LLM_TIMEOUT_MS = 15000;  // timeout for LLM calls
const LLM_MAX_TOKENS = 1024;   // generous token limit for proxied models

// English instruction; title language follows user's message
const TITLE_INSTRUCTION = `You generate a short title for a chat session based on the user's first message.

Rules:
- Maximum 20 characters.
- Write the title in the SAME language as the user's message. Do not translate.
- Output ONLY the title text. No quotes, no trailing punctuation, no explanation.`;

// ============================================================================
// Path resolution (portable, no hardcoded paths)
// ============================================================================

/**
 * Resolve OpenClaw home directory
 */
function openclawHome() {
  const env = process.env.OPENCLAW_HOME && process.env.OPENCLAW_HOME.trim();
  if (env) return env;
  return path.join(os.homedir(), '.openclaw');
}

/**
 * Resolve agent id from event context
 * sessionKey format: agent:<agentId>:<surface>:<uuid>
 */
function resolveAgentId(event) {
  // 1. From event context
  const ctxAgent = event?.context?.agentId;
  if (ctxAgent && String(ctxAgent).trim()) return String(ctxAgent).trim();
  
  // 2. From sessionKey
  const sk = event?.sessionKey ? String(event.sessionKey) : '';
  const m = sk.match(/^agent:([^:]+):/);
  if (m) return m[1];
  
  // 3. From environment
  const envAgent = process.env.OPENCLAW_AGENT_ID && process.env.OPENCLAW_AGENT_ID.trim();
  if (envAgent) return envAgent;
  
  // 4. Default
  return 'main';
}

/**
 * Get sessions file path for agent
 */
function sessionsFileFor(agentId) {
  return path.join(openclawHome(), 'agents', agentId, 'sessions', 'sessions.json');
}

/**
 * Discover OpenClaw dist directory
 */
let cachedDistDir = undefined;
function distDir() {
  if (cachedDistDir !== undefined) return cachedDistDir;
  
  const candidates = [];
  
  // 1. Environment variable
  if (process.env.OPENCLAW_DIST) {
    candidates.push(process.env.OPENCLAW_DIST);
  }
  
  // 2. Relative to running CLI
  for (const p of [process.argv[1], process.execPath]) {
    if (!p) continue;
    try {
      const dir = path.dirname(fs.realpathSync(p));
      candidates.push(path.join(dir, '../lib/node_modules/openclaw/dist'));
      candidates.push(path.join(dir, '../dist'));
    } catch (err) {
      // ignore
    }
  }
  
  // 3. Common global install locations
  candidates.push(
    path.join(os.homedir(), '.npm-global/lib/node_modules/openclaw/dist'),
    path.join(os.homedir(), '.nvm/versions/node/current/lib/node_modules/openclaw/dist'),
    '/usr/local/lib/node_modules/openclaw/dist',
    '/opt/homebrew/lib/node_modules/openclaw/dist'
  );
  
  // Find first valid dist directory
  for (const cand of candidates) {
    try {
      // Check if it contains model-*.js files
      const files = fs.readdirSync(cand);
      if (files.some(f => f.startsWith('model-') && f.endsWith('.js'))) {
        cachedDistDir = cand;
        return cand;
      }
    } catch (err) {
      // ignore
    }
  }
  
  cachedDistDir = null;
  return null;
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Extract first user message from session transcript
 */
function getFirstUserMessage(sessionFile) {
  try {
    const content = fs.readFileSync(sessionFile, 'utf8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      
      let entry;
      try {
        entry = JSON.parse(line);
      } catch (err) {
        continue;
      }
      
      if (entry === null) continue;
      
      const msg = entry.message;
      const role = entry.role || (msg && msg.role);
      const type = entry.type || (msg && msg.type);
      const text = entry.text ||
                   (msg && msg.text) ||
                   (msg && typeof msg.content === 'string' ? msg.content : null) ||
                   (entry.content && typeof entry.content === 'string' ? entry.content : null);
      
      if ((role === 'user' || type === 'user') && text && text.trim()) {
        return text.trim();
      }
    }
  } catch (err) {
    // ignore errors
  }
  return null;
}

/**
 * Fallback: truncate text for label
 */
function truncateFallback(text) {
  const t = text.trim();
  const trimmed = t.slice(0, MAX_LABEL_LEN);
  return trimmed.length < t.length ? trimmed + '…' : trimmed;
}

/**
 * Clean LLM-generated title
 */
function cleanTitle(raw) {
  if (!raw) return null;
  let t = String(raw).trim();
  // Remove surrounding quotes and normalize whitespace
  t = t.replace(/^["'「『《\s]+|["'」』》\s]+$/g, '')
       .replace(/\s+/g, ' ')
       .trim();
  if (!t) return null;
  return t.slice(0, TITLE_MAX_LEN);
}

/**
 * Resolve real provider id (sessions.json stores aliases)
 */
function resolveRealProvider(cfg, sessModel, sessProvider) {
  const providers = cfg?.models?.providers || {};
  
  // 1. Exact provider match
  if (sessProvider && providers[sessProvider]) {
    const models = providers[sessProvider].models || [];
    if (models.some(m => m.id === sessModel)) return sessProvider;
  }
  
  // 2. Find any provider containing this model
  for (const [pid, provider] of Object.entries(providers)) {
    const models = provider?.models || [];
    if (models.some(m => m.id === sessModel)) return pid;
  }
  
  return null;
}

// ============================================================================
// OpenClaw internal module import
// ============================================================================

/**
 * Import hashed dist module by exported symbol name
 */
async function importDistExport(globPattern, name) {
  const dist = distDir();
  if (!dist) return null;
  
  const re = new RegExp('\\b' + name + ' as (\\w+)');
  
  for await (const file of glob(path.join(dist, globPattern))) {
    let src;
    try {
      src = fs.readFileSync(file, 'utf8');
    } catch (err) {
      continue;
    }
    
    const m = src.match(re);
    if (m) {
      try {
        const mod = await import(file);
        const fn = mod[m[1]] || mod[name];
        if (typeof fn === 'function') return fn;
      } catch (err) {
        continue;
      }
    }
  }
  
  return null;
}

/**
 * Generate title using current session's model
 */
async function generateTitle(cfg, provider, model, userMessage, agentDir) {
  // Import all required OpenClaw internal functions
  const [
    resolveModelAsync,
    prepareModelForSimpleCompletion,
    getRuntimeAuthForModel,
    requireApiKey,
    applyPreparedRuntimeAuthToModel,
    completeSimple
  ] = await Promise.all([
    importDistExport('model-*.js', 'resolveModelAsync'),
    importDistExport('simple-completion-transport-*.js', 'prepareModelForSimpleCompletion'),
    importDistExport('runtime-model-auth.runtime-*.js', 'getRuntimeAuthForModel'),
    importDistExport('model-auth-runtime-shared-*.js', 'requireApiKey'),
    importDistExport('provider-request-config-*.js', 'applyPreparedRuntimeAuthToModel'),
    importDistExport('stream-*.js', 'completeSimple'),
  ]);
  
  // Check if all imports succeeded
  if (!resolveModelAsync || !prepareModelForSimpleCompletion || !getRuntimeAuthForModel ||
      !requireApiKey || !applyPreparedRuntimeAuthToModel || !completeSimple) {
    return null;
  }
  
  try {
    // Resolve model configuration
    const resolved = await resolveModelAsync(provider, model, agentDir, cfg);
    if (!resolved?.model) return null;
    
    // Prepare model for one-shot completion
    const completionModel = prepareModelForSimpleCompletion({ model: resolved.model, cfg });
    
    // Get runtime authentication
    const runtimeAuth = await getRuntimeAuthForModel({
      model: completionModel,
      cfg,
      workspaceDir: agentDir
    });
    
    const apiKey = requireApiKey(runtimeAuth, provider);
    const runtimeModel = applyPreparedRuntimeAuthToModel(completionModel, runtimeAuth);
    
    // Set up timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    
    try {
      // Combine instruction with user message (some proxies reject system messages)
      const combined = `${TITLE_INSTRUCTION}\n\n---\nUser's first message:\n${userMessage}`;
      
      const result = await completeSimple(runtimeModel, {
        messages: [{ role: 'user', content: combined, timestamp: Date.now() }],
      }, {
        apiKey,
        maxTokens: LLM_MAX_TOKENS,
        temperature: 0.3,
        signal: controller.signal,
      });
      
      if (result?.stopReason === 'error') return null;
      
      // Extract text from response
      const text = (result?.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim();
      
      return cleanTitle(text);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return null;
  }
}

// ============================================================================
// Main hook handler
// ============================================================================

module.exports = async function handler(event) {
  // Only handle message received events
  if (event.type !== 'message' || event.action !== 'received') return;
  
  const sessionKey = event.sessionKey;
  if (!sessionKey) return;
  
  // Resolve paths
  const agentId = resolveAgentId(event);
  const sessionsFile = sessionsFileFor(agentId);
  const configFile = path.join(openclawHome(), 'openclaw.json');
  const agentDir = path.join(openclawHome(), 'agents', agentId);
  
  // Read sessions
  let sessions;
  try {
    sessions = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
  } catch (err) {
    return;
  }
  
  const sess = sessions[sessionKey];
  if (!sess) return;
  
  // Skip if already labeled
  if (sess.label && sess.label.trim()) return;
  
  // Need session file
  if (!sess.sessionFile) return;
  
  // Get first user message
  const ctxContent = event.context?.content ? String(event.context.content).trim() : null;
  const firstMsg = ctxContent || getFirstUserMessage(sess.sessionFile);
  if (!firstMsg) return;
  
  let label = null;
  
  // Try LLM title generation
  try {
    const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    const sessModel = sess.modelOverride || sess.model;
    const sessProvider = sess.providerOverride || sess.modelProvider;
    
    if (sessModel) {
      const provider = resolveRealProvider(cfg, sessModel, sessProvider);
      if (provider) {
        label = await generateTitle(cfg, provider, sessModel, firstMsg, agentDir);
      }
    }
  } catch (err) {
    // Fall through to backup
  }
  
  // Fallback to truncation
  if (!label) {
    label = truncateFallback(firstMsg);
  }
  
  if (!label) return;
  
  // Write back with concurrency safety
  try {
    const fresh = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
    const target = fresh[sessionKey];
    
    if (!target) return;
    if (target.label && target.label.trim()) return; // Already labeled
    
    target.label = label;
    fs.writeFileSync(sessionsFile, JSON.stringify(fresh, null, 2), 'utf8');
  } catch (err) {
    // Silently fail
  }
};
