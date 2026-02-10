export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
}

interface CorsHeaders {
  'Access-Control-Allow-Origin': string;
  'Access-Control-Allow-Methods': string;
  'Access-Control-Allow-Headers': string;
}

const corsHeaders: CorsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function generateId(): string {
  return crypto.randomUUID();
}

function generateApiKey(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return 'br_' + Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Route handlers
    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      return handleRegister(request, env);
    }

    if (url.pathname === '/api/usage/submit' && request.method === 'POST') {
      return handleUsageSubmit(request, env);
    }

    if (url.pathname === '/api/leaderboard' && request.method === 'GET') {
      return handleLeaderboard(request, env);
    }

    if (url.pathname === '/api/usage/me' && request.method === 'GET') {
      return handleMyUsage(request, env);
    }

    if (url.pathname === '/api/profile/update' && request.method === 'POST') {
      return handleProfileUpdate(request, env);
    }

    // Serve static HTML for root
    if (url.pathname === '/') {
      return new Response(getIndexHTML(), {
        headers: { 
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};

async function handleRegister(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { displayName: string };

    if (!body.displayName) {
      return jsonResponse({ error: 'Display name required' }, 400);
    }

    const userId = generateId();
    const apiKey = generateApiKey();
    const now = Date.now();

    await env.DB.prepare(
      'INSERT INTO users (id, api_key, display_name, created_at) VALUES (?, ?, ?, ?)'
    )
      .bind(userId, apiKey, body.displayName, now)
      .run();

    return jsonResponse({
      userId,
      apiKey,
      displayName: body.displayName,
    });
  } catch (error) {
    return jsonResponse({ error: 'Registration failed' }, 500);
  }
}

async function handleUsageSubmit(request: Request, env: Env): Promise<Response> {
  try {
    // Extract API key from Authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing API key' }, 401);
    }

    const apiKey = authHeader.substring(7);

    // Verify API key and get user
    const user = await env.DB.prepare('SELECT id FROM users WHERE api_key = ?')
      .bind(apiKey)
      .first<{ id: string }>();

    if (!user) {
      return jsonResponse({ error: 'Invalid API key' }, 401);
    }

    // Parse ccusage JSON output
    const body = await request.json() as any;

    // Current month key (e.g. "2026-02")
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    // ccusage monthly --json returns: { monthly: [{ month: "2026-02", inputTokens, ... }] }
    // ccusage daily --json returns: { daily: [{ date: "2026-02-01", ... }] }
    // Also support flat object with token fields
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;

    if (body.monthly) {
      // Monthly format — find current month entry
      const entry = body.monthly.find((e: any) => e.month === month);
      if (entry) {
        inputTokens = entry.inputTokens || 0;
        outputTokens = entry.outputTokens || 0;
        const cacheCreate = entry.cacheCreationTokens || entry.cacheCreateTokens || 0;
        const cacheRead = entry.cacheReadTokens || 0;
        totalTokens = inputTokens + outputTokens + cacheCreate + cacheRead;
      }
    } else {
      // Daily format — sum entries matching current month
      const entries: any[] = body.daily || body.data || [body];
      for (const entry of entries) {
        if (entry.date && entry.date.startsWith(month)) {
          const inp = entry.inputTokens || 0;
          const out = entry.outputTokens || 0;
          const cacheCreate = entry.cacheCreationTokens || entry.cacheCreateTokens || 0;
          const cacheRead = entry.cacheReadTokens || 0;
          inputTokens += inp;
          outputTokens += out;
          totalTokens += inp + out + cacheCreate + cacheRead;
        }
      }
    }

    // Upsert one row per user per month — idempotent
    await env.DB.prepare(`
      INSERT INTO monthly_usage (user_id, month, input_tokens, output_tokens, total_tokens, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, month) DO UPDATE SET
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        total_tokens = excluded.total_tokens,
        updated_at = excluded.updated_at
    `).bind(user.id, month, inputTokens, outputTokens, totalTokens, Date.now()).run();

    return jsonResponse({ success: true, month, total_tokens: totalTokens });
  } catch (error) {
    console.error('Usage submit error:', error);
    return jsonResponse({ error: 'Failed to submit usage' }, 500);
  }
}

async function handleLeaderboard(request: Request, env: Env): Promise<Response> {
  try {
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const monthLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

    const results = await env.DB.prepare(`
      SELECT u.display_name, m.input_tokens, m.output_tokens, m.total_tokens
      FROM monthly_usage m
      JOIN users u ON m.user_id = u.id
      WHERE m.month = ? AND m.total_tokens > 0
      ORDER BY m.total_tokens DESC
      LIMIT 50
    `).bind(month).all();

    const leaderboard = results.results?.map((row: any, index: number) => ({
      rank: index + 1,
      name: row.display_name || 'Unknown',
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      total_tokens: row.total_tokens,
    })) || [];

    return jsonResponse({ month: monthLabel, leaderboard });
  } catch (error) {
    return jsonResponse({ error: 'Failed to fetch leaderboard' }, 500);
  }
}

async function handleMyUsage(request: Request, env: Env): Promise<Response> {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing API key' }, 401);
    }

    const apiKey = authHeader.substring(7);
    const user = await env.DB.prepare('SELECT id, display_name FROM users WHERE api_key = ?')
      .bind(apiKey)
      .first<{ id: string; display_name: string }>();

    if (!user) {
      return jsonResponse({ error: 'Invalid API key' }, 401);
    }

    const stats = await env.DB.prepare(`
      SELECT 
        month,
        input_tokens,
        output_tokens,
        total_tokens,
        updated_at
      FROM monthly_usage
      WHERE user_id = ?
      ORDER BY month DESC
      LIMIT 12
    `).bind(user.id).all();

    return jsonResponse({
      displayName: user.display_name,
      stats: stats.results || [],
    });
  } catch (error) {
    return jsonResponse({ error: 'Failed to fetch usage' }, 500);
  }
}

async function handleProfileUpdate(request: Request, env: Env): Promise<Response> {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing API key' }, 401);
    }

    const apiKey = authHeader.substring(7);
    const user = await env.DB.prepare('SELECT id FROM users WHERE api_key = ?')
      .bind(apiKey)
      .first<{ id: string }>();

    if (!user) {
      return jsonResponse({ error: 'Invalid API key' }, 401);
    }

    const body = await request.json() as { displayName?: string };

    if (!body.displayName) {
      return jsonResponse({ error: 'No updates provided' }, 400);
    }

    const updates = ['display_name = ?'];
    const values = [body.displayName];

    values.push(user.id);

    await env.DB.prepare(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run();

    return jsonResponse({ success: true, message: 'Profile updated' });
  } catch (error) {
    return jsonResponse({ error: 'Failed to update profile' }, 500);
  }
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

function getIndexHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Burn Rate Leaderboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f8f9fa;
      color: #1a1a1a;
      min-height: 100vh;
    }

    /* Header */
    .header {
      background: #fff;
      border-bottom: 1px solid #e5e7eb;
      padding: 1.25rem 2rem;
    }
    .header-inner {
      max-width: 960px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .header-icon {
      font-size: 1.5rem;
    }
    .header-title {
      font-family: "SF Mono", "Fira Code", "Fira Mono", "Roboto Mono", monospace;
      font-size: 1.25rem;
      font-weight: 700;
      color: #1a1a1a;
    }
    .header-subtitle {
      font-size: 0.85rem;
      color: #6b7280;
      margin-top: 2px;
    }
    .header-actions {
      display: flex;
      gap: 0.75rem;
      align-items: center;
    }
    .btn-refresh {
      background: none;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 0.5rem;
      cursor: pointer;
      color: #6b7280;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }
    .btn-refresh:hover { background: #f3f4f6; }
    .btn-refresh.spinning svg { animation: spin 1s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .btn-primary {
      background: #22c55e;
      color: #fff;
      padding: 0.5rem 1.25rem;
      border-radius: 8px;
      border: none;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-primary:hover { background: #16a34a; }
    .btn-outline {
      background: transparent;
      color: #374151;
      padding: 0.5rem 1.25rem;
      border-radius: 8px;
      border: 1px solid #d1d5db;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-outline:hover { background: #f3f4f6; }

    /* Container */
    .container { max-width: 960px; margin: 0 auto; padding: 1.5rem 2rem; }

    /* Month label */
    .month-label {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      font-size: 0.9rem;
      color: #6b7280;
      margin-bottom: 1rem;
    }
    .month-label svg { width: 16px; height: 16px; }

    /* Table */
    .leaderboard-table {
      width: 100%;
      background: #fff;
      border-radius: 12px;
      border: 1px solid #e5e7eb;
      overflow: hidden;
    }
    .leaderboard-table table {
      width: 100%;
      border-collapse: collapse;
    }
    .leaderboard-table thead th {
      text-align: left;
      padding: 0.75rem 1rem;
      font-size: 0.7rem;
      font-weight: 600;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid #e5e7eb;
      background: #fafafa;
    }
    .leaderboard-table thead th:nth-child(1) { width: 60px; }
    .leaderboard-table thead th:nth-child(3),
    .leaderboard-table thead th:nth-child(4),
    .leaderboard-table thead th:nth-child(5) { text-align: right; }
    .leaderboard-table tbody tr { border-bottom: 1px solid #f3f4f6; }
    .leaderboard-table tbody tr:last-child { border-bottom: none; }
    .leaderboard-table tbody td {
      padding: 0.75rem 1rem;
      font-size: 0.875rem;
      font-family: "SF Mono", "Fira Code", "Fira Mono", "Roboto Mono", monospace;
    }
    .leaderboard-table tbody td:nth-child(3),
    .leaderboard-table tbody td:nth-child(4),
    .leaderboard-table tbody td:nth-child(5) { text-align: right; }
    .leaderboard-table tbody td:nth-child(2) {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-weight: 500;
    }

    /* Rank styles */
    .rank { font-weight: 700; }
    .rank-1 { color: #ca8a04; }
    .rank-2 { color: #6b7280; }
    .rank-3 { color: #ea580c; }

    /* Row highlights */
    .row-gold { background: #fef3c7; }

    /* Token colors */
    .tokens-total { color: #22c55e; font-weight: 600; }
    .tokens-muted { color: #6b7280; }

    /* Empty state */
    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: #9ca3af;
    }
    .empty-state p { margin-top: 0.5rem; font-size: 0.9rem; }

    /* Modal */
    .modal-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    .modal-overlay.active { display: flex; }
    .modal {
      background: #fff;
      border-radius: 12px;
      max-width: 560px;
      width: 90%;
      max-height: 85vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
    }
    .modal-header {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .modal-header h2 {
      font-size: 1.1rem;
      font-weight: 700;
      color: #1a1a1a;
      margin: 0;
    }
    .modal-close {
      background: none;
      border: none;
      font-size: 1.25rem;
      cursor: pointer;
      color: #9ca3af;
      padding: 4px;
      line-height: 1;
      border-radius: 4px;
      transition: color 0.15s;
    }
    .modal-close:hover { color: #374151; }
    .modal-body { padding: 1.5rem; }

    /* Tabs */
    .tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid #e5e7eb;
      margin-bottom: 1.25rem;
    }
    .tab-btn {
      background: none;
      border: none;
      padding: 0.625rem 1.25rem;
      font-size: 0.875rem;
      font-weight: 500;
      color: #9ca3af;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.15s;
      margin-bottom: -1px;
    }
    .tab-btn.active { color: #22c55e; border-bottom-color: #22c55e; }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* Code block */
    .code-block {
      background: #f8f9fa;
      color: #1a1a1a;
      padding: 0.875rem 1rem;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      font-family: "SF Mono", "Fira Code", "Fira Mono", "Roboto Mono", monospace;
      font-size: 0.8rem;
      overflow-x: auto;
      margin: 0 0 0.25rem 0;
      line-height: 1.6;
      position: relative;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .step .code-block { margin-left: 0; }
    .code-block .hl { color: #22c55e; font-weight: 600; }
    .code-block .comment { color: #6b7280; }
    .copy-btn {
      position: absolute;
      top: 0.5rem;
      right: 0.5rem;
      background: #fff;
      border: 1px solid #e5e7eb;
      color: #6b7280;
      padding: 3px 10px;
      border-radius: 6px;
      font-size: 0.7rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
    }
    .copy-btn:hover { background: #f3f4f6; color: #374151; }

    /* Form */
    .form-group { margin-bottom: 1rem; }
    .form-label {
      display: block;
      margin-bottom: 0.375rem;
      font-size: 0.8rem;
      font-weight: 600;
      color: #374151;
    }
    .form-input {
      width: 100%;
      padding: 0.625rem 0.75rem;
      border-radius: 8px;
      border: 1px solid #d1d5db;
      font-size: 0.875rem;
      color: #1a1a1a;
      background: #fff;
      transition: border-color 0.15s;
    }
    .form-input:focus { outline: none; border-color: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,0.1); }
    .form-input::placeholder { color: #9ca3af; }
    .btn-submit {
      width: 100%;
      background: #22c55e;
      color: #fff;
      padding: 0.625rem;
      border-radius: 8px;
      border: none;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      margin-top: 0.5rem;
      transition: background 0.15s;
    }
    .btn-submit:hover { background: #16a34a; }

    .step { margin-bottom: 1.5rem; }
    .step:last-child { margin-bottom: 0; }
    .step-header { display: flex; align-items: center; gap: 0.625rem; margin-bottom: 0.5rem; }
    .step-num {
      width: 24px; height: 24px; border-radius: 50%;
      background: #22c55e; color: #fff;
      font-size: 0.75rem; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .step-title { font-size: 0.875rem; font-weight: 600; color: #1a1a1a; }
    .step-desc { font-size: 0.8rem; color: #6b7280; margin-bottom: 0.5rem; line-height: 1.5; }

    .success-msg { color: #22c55e; font-weight: 500; }
    .error-msg { color: #ef4444; font-weight: 500; }
    .api-key-display {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      padding: 0.75rem;
      border-radius: 8px;
      font-family: "SF Mono", monospace;
      font-size: 0.8rem;
      word-break: break-all;
      margin: 0.75rem 0;
    }
    .warning-text { color: #ca8a04; font-size: 0.8rem; margin-bottom: 0.75rem; }

    @media (max-width: 640px) {
      .header { flex-direction: column; gap: 1rem; padding: 1rem; }
      .header-actions { width: 100%; justify-content: center; }
      .container { padding: 1rem; }
      .leaderboard-table { font-size: 0.8rem; }
      .leaderboard-table thead th,
      .leaderboard-table tbody td { padding: 0.5rem 0.625rem; }
    }
  </style>
</head>
<body>
  <!-- Header -->
  <header class="header">
    <div class="header-inner">
      <div class="header-left">
        <span class="header-icon">&#x26A1;</span>
        <div>
          <div class="header-title">Burn Rate Leaderboard</div>
          <div class="header-subtitle">Autonomous &mdash; Who&#39;s burning the most tokens?</div>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn-refresh" id="refreshBtn" title="Refresh">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
        </button>
        <button class="btn-primary" id="updateBtn">Update My Usage</button>
        <button class="btn-outline" id="joinBtn">Join Leaderboard</button>
      </div>
    </div>
  </header>

  <!-- Main Content -->
  <div class="container">
    <div class="month-label">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      <span id="monthLabel">Loading...</span>
    </div>

    <div class="leaderboard-table">
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>User</th>
            <th>Input Tokens</th>
            <th>Output Tokens</th>
            <th>Total Tokens</th>
          </tr>
        </thead>
        <tbody id="leaderboardBody">
          <tr><td colspan="5" class="empty-state"><div>Loading...</div></td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Update Usage Modal -->
  <div class="modal-overlay" id="updateOverlay">
    <div class="modal">
      <div class="modal-header">
        <h2>Submit Your Usage</h2>
        <button class="modal-close" id="updateClose">&times;</button>
      </div>
      <div class="modal-body">
        <div class="tabs">
          <button class="tab-btn active" data-tab="manual">Manual Update</button>
          <button class="tab-btn" data-tab="auto">Auto Update (Hook)</button>
        </div>

        <!-- Manual Tab -->
        <div class="tab-panel active" id="panel-manual">
          <p style="color: #6b7280; font-size: 0.85rem; margin-bottom: 1rem; line-height: 1.5;">Run this command in your terminal to submit your usage:</p>
          <div class="code-block" id="manualCodeBlock">npx ccusage@latest monthly --json | curl -X POST \\
  "https://burnrate.autonomoustech.ca/api/usage/submit" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <span class="hl" id="apiKeySlot1">YOUR_API_KEY</span>" \\
  -d @-<button class="copy-btn" id="copyManualBtn">Copy</button></div>
        </div>

        <!-- Auto Tab -->
        <div class="tab-panel" id="panel-auto">
          <p style="color: #6b7280; font-size: 0.85rem; margin-bottom: 1.25rem; line-height: 1.5;">Automatically submit your usage every time a Claude Code session ends.</p>

          <div class="step">
            <div class="step-header"><span class="step-num">1</span><span class="step-title">Create the script directory</span></div>
            <div class="code-block">mkdir -p ~/.claude/hooks/scripts<button class="copy-btn" data-copy="mkdir -p ~/.claude/hooks/scripts">Copy</button></div>
          </div>

          <div class="step">
            <div class="step-header"><span class="step-num">2</span><span class="step-title">Create the hook script</span></div>
            <div class="step-desc">This script runs ccusage and sends the data to burnrate.</div>
            <div class="code-block"><span class="comment">#!/bin/bash</span>
API_KEY="<span class="hl" id="apiKeySlot2">YOUR_API_KEY</span>"

npx ccusage@latest monthly --json | curl -s -X POST \\
  "https://burnrate.autonomoustech.ca/api/usage/submit" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $API_KEY" \\
  -d @-<button class="copy-btn" id="copyScriptBtn">Copy</button></div>
            <div class="step-desc">Save this as <strong>~/.claude/hooks/scripts/burnrate.sh</strong>, then make it executable:</div>
            <div class="code-block">chmod +x ~/.claude/hooks/scripts/burnrate.sh<button class="copy-btn" data-copy="chmod +x ~/.claude/hooks/scripts/burnrate.sh">Copy</button></div>
          </div>

          <div class="step">
            <div class="step-header"><span class="step-num">3</span><span class="step-title">Add the hook to Claude Code</span></div>
            <div class="step-desc">Add this to your <strong>~/.claude/settings.json</strong> to run the script on every session end:</div>
            <div class="code-block">{
  "hooks": {
    "SessionEnd": [
      {
        "type": "command",
        "command": "~/.claude/hooks/scripts/burnrate.sh"
      }
    ]
  }
}<button class="copy-btn" id="copyHookBtn">Copy</button></div>
          </div>

          <div class="step">
            <div class="step-header"><span class="step-num">4</span><span class="step-title">Test it</span></div>
            <div class="step-desc">Run the script manually to make sure it works:</div>
            <div class="code-block">~/.claude/hooks/scripts/burnrate.sh<button class="copy-btn" data-copy="~/.claude/hooks/scripts/burnrate.sh">Copy</button></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Join Leaderboard Modal -->
  <div class="modal-overlay" id="joinOverlay">
    <div class="modal" style="max-width: 420px;">
      <div class="modal-header">
        <h2 id="joinTitle">Create Your Profile</h2>
        <button class="modal-close" id="joinClose">&times;</button>
      </div>
      <div class="modal-body">
        <form id="joinForm">
          <div class="form-group">
            <label class="form-label" for="joinUsername">Username</label>
            <input class="form-input" type="text" id="joinUsername" placeholder="Display name for leaderboard" required>
          </div>
          <button type="submit" class="btn-submit" id="joinSubmitBtn">Create Profile</button>
        </form>
        <div id="joinResult" style="margin-top: 1rem;"></div>
      </div>
    </div>
  </div>

  <script>
    // --- Utility ---
    function formatTokens(n) {
      if (n == null) return "0";
      if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
      if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
      if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
      return n.toString();
    }

    // --- Modal management ---
    function openModal(id) {
      document.getElementById(id).classList.add("active");
    }
    function closeModal(id) {
      document.getElementById(id).classList.remove("active");
    }

    // Header buttons
    document.getElementById("updateBtn").addEventListener("click", function() {
      var stored = localStorage.getItem("burnrate_apikey");
      if (stored) {
        document.getElementById("apiKeySlot1").textContent = stored;
        document.getElementById("apiKeySlot2").textContent = stored;
      }
      openModal("updateOverlay");
    });
    document.getElementById("joinBtn").addEventListener("click", function() {
      var hasKey = localStorage.getItem("burnrate_apikey");
      var titleEl = document.getElementById("joinTitle");
      var submitBtn = document.getElementById("joinSubmitBtn");
      document.getElementById("joinResult").innerHTML = "";
      if (hasKey) {
        titleEl.textContent = "Update Your Profile";
        submitBtn.textContent = "Update Profile";
      } else {
        titleEl.textContent = "Create Your Profile";
        submitBtn.textContent = "Create Profile";
      }
      openModal("joinOverlay");
    });
    document.getElementById("refreshBtn").addEventListener("click", function() {
      this.classList.add("spinning");
      loadLeaderboard().finally(function() {
        document.getElementById("refreshBtn").classList.remove("spinning");
      });
    });

    // Close buttons
    document.getElementById("updateClose").addEventListener("click", function() {
      closeModal("updateOverlay");
    });
    document.getElementById("joinClose").addEventListener("click", function() {
      closeModal("joinOverlay");
    });

    // Close on backdrop click
    document.getElementById("updateOverlay").addEventListener("click", function(e) {
      if (e.target === this) closeModal("updateOverlay");
    });
    document.getElementById("joinOverlay").addEventListener("click", function(e) {
      if (e.target === this) closeModal("joinOverlay");
    });

    // --- Tabs ---
    document.querySelectorAll(".tab-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var tabName = this.getAttribute("data-tab");
        // Update buttons
        this.parentElement.querySelectorAll(".tab-btn").forEach(function(b) { b.classList.remove("active"); });
        this.classList.add("active");
        // Update panels
        var panels = this.closest(".modal-body").querySelectorAll(".tab-panel");
        panels.forEach(function(p) { p.classList.remove("active"); });
        document.getElementById("panel-" + tabName).classList.add("active");
      });
    });

    // --- Copy buttons ---
    document.querySelectorAll(".copy-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var text = this.getAttribute("data-copy");
        if (!text) {
          // Fall back to parent code-block text content
          text = this.parentElement.textContent.replace("Copy", "").replace("Copied!", "").trim();
        }
        var el = this;
        navigator.clipboard.writeText(text).then(function() {
          el.textContent = "Copied!";
          setTimeout(function() { el.textContent = "Copy"; }, 2000);
        });
      });
    });

    // --- Join / Register form ---
    document.getElementById("joinForm").addEventListener("submit", function(e) {
      e.preventDefault();
      var username = document.getElementById("joinUsername").value;
      var resultEl = document.getElementById("joinResult");
      var submitBtn = document.getElementById("joinSubmitBtn");
      var apiKey = localStorage.getItem("burnrate_apikey");

      submitBtn.disabled = true;

      // If user already has an API key, update profile instead
      if (apiKey) {
        submitBtn.textContent = "Updating...";
        fetch("/api/profile/update", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
          body: JSON.stringify({ displayName: username, isPublic: true })
        })
        .then(function(resp) { return resp.json().then(function(d) { return { ok: resp.ok, data: d }; }); })
        .then(function(result) {
          if (result.ok) {
            localStorage.setItem("burnrate_username", username);
            resultEl.innerHTML = "<p class=\\"success-msg\\">Profile updated!</p>";
            setTimeout(function() { closeModal("joinOverlay"); loadLeaderboard(); }, 1500);
          } else {
            resultEl.innerHTML = "<p class=\\"error-msg\\">" + result.data.error + "</p>";
          }
          submitBtn.disabled = false;
          submitBtn.textContent = "Update Profile";
        })
        .catch(function() {
          resultEl.innerHTML = "<p class=\\"error-msg\\">Update failed. Please try again.</p>";
          submitBtn.disabled = false;
          submitBtn.textContent = "Update Profile";
        });
        return;
      }

      submitBtn.textContent = "Creating...";

      fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: username })
      })
      .then(function(resp) { return resp.json().then(function(d) { return { ok: resp.ok, data: d }; }); })
      .then(function(result) {
        if (result.ok) {
          localStorage.setItem("burnrate_apikey", result.data.apiKey);
          localStorage.setItem("burnrate_username", username);
          document.getElementById("apiKeySlot1").textContent = result.data.apiKey;
          document.getElementById("apiKeySlot2").textContent = result.data.apiKey;
          resultEl.innerHTML =
            "<p class=\\"success-msg\\">Profile created!</p>" +
            "<div class=\\"api-key-display\\">" + result.data.apiKey + "</div>" +
            "<p class=\\"warning-text\\">Save this API key &mdash; you won&#39;t see it again!</p>" +
            "<button class=\\"btn-submit\\" id=\\"viewSetupBtn\\">View Setup Instructions</button>";
          document.getElementById("viewSetupBtn").addEventListener("click", function() {
            closeModal("joinOverlay");
            openModal("updateOverlay");
          });
        } else {
          resultEl.innerHTML = "<p class=\\"error-msg\\">" + result.data.error + "</p>";
        }
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Profile";
      })
      .catch(function() {
        resultEl.innerHTML = "<p class=\\"error-msg\\">Registration failed. Please try again.</p>";
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Profile";
      });
    });

    // --- Leaderboard ---
    function loadLeaderboard() {
      return fetch("/api/leaderboard")
        .then(function(resp) { return resp.json(); })
        .then(function(data) {
          if (data.month) {
            document.getElementById("monthLabel").textContent = data.month + " Leaderboard";
          }
          var tbody = document.getElementById("leaderboardBody");
          if (!data.leaderboard || data.leaderboard.length === 0) {
            tbody.innerHTML = "<tr><td colspan=\\"5\\" style=\\"text-align:center;padding:3rem 1rem;color:#9ca3af;\\">No entries yet. Be the first to submit your usage!</td></tr>";
            return;
          }

          var html = "";
          data.leaderboard.forEach(function(item) {
            var rankClass = "";
            var rowClass = "";
            var rankPrefix = "";
            var totalSuffix = "";

            if (item.rank === 1) { rankClass = "rank-1"; rowClass = "row-gold"; rankPrefix = "&#x1F451; "; totalSuffix = " &#x1F525;"; }
            else if (item.rank === 2) { rankClass = "rank-2"; }
            else if (item.rank === 3) { rankClass = "rank-3"; }

            html += "<tr class=\\"" + rowClass + "\\">" +
              "<td><span class=\\"rank " + rankClass + "\\">" + rankPrefix + "#" + item.rank + "</span></td>" +
              "<td>" + item.name + "</td>" +
              "<td class=\\"tokens-muted\\">" + formatTokens(item.input_tokens) + "</td>" +
              "<td class=\\"tokens-muted\\">" + formatTokens(item.output_tokens) + "</td>" +
              "<td class=\\"tokens-total\\">" + formatTokens(item.total_tokens) + totalSuffix + "</td>" +
              "</tr>";
          });

          tbody.innerHTML = html;
        })
        .catch(function() {
          document.getElementById("leaderboardBody").innerHTML =
            "<tr><td colspan=\\"5\\" style=\\"text-align:center;padding:2rem;color:#ef4444;\\">Failed to load leaderboard</td></tr>";
        });
    }

    loadLeaderboard();
    setInterval(loadLeaderboard, 30000);
  </script>
</body>
</html>`;
}
