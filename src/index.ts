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

    if (url.pathname === '/api/leaderboard/daily' && request.method === 'GET') {
      return handleLeaderboard(request, env, 'daily');
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
        headers: { 'Content-Type': 'text/html' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};

async function handleRegister(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { email: string; displayName?: string };
    
    if (!body.email) {
      return jsonResponse({ error: 'Email required' }, 400);
    }

    // Check if user exists
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(body.email)
      .first();

    if (existing) {
      return jsonResponse({ error: 'Email already registered' }, 409);
    }

    const userId = generateId();
    const apiKey = generateApiKey();
    const now = Date.now();

    await env.DB.prepare(
      'INSERT INTO users (id, email, api_key, display_name, created_at) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(userId, body.email, apiKey, body.displayName || null, now)
      .run();

    return jsonResponse({
      userId,
      apiKey,
      email: body.email,
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

    // ccusage daily --json returns: { data: [...] }
    const entries = body.data || [body];

    const now = Date.now();
    let inserted = 0;

    for (const entry of entries) {
      const logId = generateId();
      const date = entry.date || new Date().toISOString().split('T')[0];
      
      // Insert usage log
      await env.DB.prepare(`
        INSERT INTO usage_logs 
        (id, user_id, date, model, input_tokens, output_tokens, cache_create_tokens, cache_read_tokens, cost_usd, project, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        logId,
        user.id,
        date,
        entry.model || 'unknown',
        entry.inputTokens || 0,
        entry.outputTokens || 0,
        entry.cacheCreateTokens || 0,
        entry.cacheReadTokens || 0,
        entry.cost || 0,
        entry.project || null,
        now
      ).run();

      // Update daily stats
      const totalTokens = (entry.inputTokens || 0) + (entry.outputTokens || 0) + 
                         (entry.cacheCreateTokens || 0) + (entry.cacheReadTokens || 0);

      await env.DB.prepare(`
        INSERT INTO daily_stats (user_id, date, total_tokens, total_cost)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET
          total_tokens = total_tokens + excluded.total_tokens,
          total_cost = total_cost + excluded.total_cost
      `).bind(user.id, date, totalTokens, entry.cost || 0).run();

      inserted++;
    }

    return jsonResponse({ success: true, inserted });
  } catch (error) {
    console.error('Usage submit error:', error);
    return jsonResponse({ error: 'Failed to submit usage' }, 500);
  }
}

async function handleLeaderboard(request: Request, env: Env, period: string): Promise<Response> {
  try {
    const today = new Date().toISOString().split('T')[0];

    const results = await env.DB.prepare(`
      SELECT 
        u.display_name,
        u.email,
        u.is_public,
        s.total_tokens,
        s.total_cost
      FROM daily_stats s
      JOIN users u ON s.user_id = u.id
      WHERE s.date = ?
      ORDER BY s.total_tokens DESC
      LIMIT 10
    `).bind(today).all();

    const leaderboard = results.results?.map((row: any, index: number) => ({
      rank: index + 1,
      name: row.is_public ? (row.display_name || row.email.split('@')[0]) : 'Anonymous',
      tokens: row.total_tokens,
      cost: row.total_cost,
    })) || [];

    return jsonResponse({ period, date: today, leaderboard });
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
    const user = await env.DB.prepare('SELECT id, email, display_name FROM users WHERE api_key = ?')
      .bind(apiKey)
      .first<{ id: string; email: string; display_name: string }>();

    if (!user) {
      return jsonResponse({ error: 'Invalid API key' }, 401);
    }

    const today = new Date().toISOString().split('T')[0];

    const stats = await env.DB.prepare(`
      SELECT 
        date,
        total_tokens,
        total_cost
      FROM daily_stats
      WHERE user_id = ?
      ORDER BY date DESC
      LIMIT 30
    `).bind(user.id).all();

    return jsonResponse({
      email: user.email,
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

    const body = await request.json() as { displayName?: string; isPublic?: boolean };

    // Update user profile
    const updates: string[] = [];
    const values: any[] = [];

    if (body.displayName !== undefined) {
      updates.push('display_name = ?');
      values.push(body.displayName);
    }

    if (body.isPublic !== undefined) {
      updates.push('is_public = ?');
      values.push(body.isPublic ? 1 : 0);
    }

    if (updates.length === 0) {
      return jsonResponse({ error: 'No updates provided' }, 400);
    }

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
  <title>burnrate - Track Your Claude Code Token Usage</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
      min-height: 100vh;
    }
    
    /* Navbar */
    .navbar {
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    }
    .navbar-brand {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.5rem;
      font-weight: 600;
    }
    .navbar-actions {
      display: flex;
      gap: 1rem;
    }
    .btn {
      background: #fff;
      color: #667eea;
      padding: 0.5rem 1.5rem;
      border-radius: 8px;
      border: none;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .btn:hover { transform: translateY(-2px); }
    .btn-outline {
      background: transparent;
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.3);
    }
    
    .container { max-width: 1000px; margin: 0 auto; padding: 2rem; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    h2 { font-size: 1.5rem; margin-bottom: 1rem; }
    h3 { font-size: 1.1rem; margin-top: 1.5rem; margin-bottom: 0.5rem; opacity: 0.95; }
    .tagline { font-size: 1.2rem; opacity: 0.9; margin-bottom: 2rem; }
    
    .card {
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 2rem;
      margin-bottom: 2rem;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }
    
    /* Modal */
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(5px);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    .modal.active { display: flex; }
    .modal-content {
      background: rgba(255, 255, 255, 0.95);
      color: #333;
      border-radius: 16px;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    }
    .modal-header {
      padding: 1.5rem;
      border-bottom: 1px solid rgba(0, 0, 0, 0.1);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .modal-header h2 { margin: 0; color: #333; }
    .modal-close {
      background: none;
      border: none;
      font-size: 1.5rem;
      cursor: pointer;
      color: #666;
      padding: 0;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .modal-body { padding: 1.5rem; }
    
    /* Tabs */
    .tabs {
      display: flex;
      gap: 1rem;
      border-bottom: 2px solid rgba(0, 0, 0, 0.1);
      margin-bottom: 1.5rem;
    }
    .tab {
      background: none;
      border: none;
      padding: 0.75rem 1.5rem;
      font-size: 1rem;
      font-weight: 500;
      color: #666;
      cursor: pointer;
      border-bottom: 3px solid transparent;
      transition: all 0.2s;
    }
    .tab.active {
      color: #667eea;
      border-bottom-color: #667eea;
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    
    .code-block {
      background: rgba(0, 0, 0, 0.05);
      padding: 1rem;
      border-radius: 8px;
      font-family: 'Courier New', monospace;
      font-size: 0.85rem;
      overflow-x: auto;
      margin: 1rem 0;
      border: 1px solid rgba(0, 0, 0, 0.1);
      color: #333;
    }
    .code-block .highlight { background: #fef3c7; padding: 0 4px; }
    
    .leaderboard-item {
      display: flex;
      justify-content: space-between;
      padding: 0.75rem;
      background: rgba(255, 255, 255, 0.05);
      margin-bottom: 0.5rem;
      border-radius: 8px;
    }
    .form-group { margin-bottom: 1.5rem; }
    label { display: block; margin-bottom: 0.5rem; font-weight: 500; }
    input {
      width: 100%;
      padding: 0.75rem;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
      font-size: 1rem;
    }
    input::placeholder { color: rgba(255, 255, 255, 0.5); }
    .success { color: #4ade80; }
    .error { color: #f87171; }
    #setupInstructions { display: none; }
    .step { margin-bottom: 1.5rem; }
    .step h4 { color: #555; font-size: 0.9rem; margin-bottom: 0.5rem; }
    .step p { color: #666; font-size: 0.9rem; margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <!-- Navbar -->
  <nav class="navbar">
    <div class="navbar-brand">
      <span>🔥</span>
      <span>burnrate</span>
    </div>
    <div class="navbar-actions">
      <button class="btn" onclick="openUpdateModal()">📊 Update My Usage</button>
      <button class="btn btn-outline" onclick="openJoinModal()">🏆 Join Leaderboard</button>
    </div>
  </nav>

  <!-- Main Content -->
  <div class="container">
    <h1>Track Your Token Burn Rate</h1>
    <p class="tagline">Competitive leaderboard for Claude Code usage</p>

    <div class="card">
      <h2>Get Started</h2>
      <form id="registerForm">
        <div class="form-group">
          <label for="email">Email</label>
          <input type="email" id="email" placeholder="you@example.com" required>
        </div>
        <div class="form-group">
          <label for="displayName">Display Name (optional)</label>
          <input type="text" id="displayName" placeholder="Your Name">
        </div>
        <button type="submit" class="btn">Generate API Key</button>
      </form>
      <div id="result"></div>
    </div>

    <div class="card">
      <h2>Today's Leaderboard</h2>
      <div id="leaderboardContent">Loading...</div>
    </div>
  </div>

  <!-- Update Usage Modal -->
  <div id="updateModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2>Submit Your Usage</h2>
        <button class="modal-close" onclick="closeUpdateModal()">×</button>
      </div>
      <div class="modal-body">
        <p style="color: #666; margin-bottom: 1rem;">Use ccusage to export your Claude Code usage and submit it to the leaderboard.</p>
        
        <!-- Tabs -->
        <div class="tabs">
          <button class="tab active" onclick="switchTab('manual')">Manual Update</button>
          <button class="tab" onclick="switchTab('auto')">Auto Update</button>
        </div>
        
        <!-- Manual Update Tab -->
        <div id="manualTab" class="tab-content active">
          <p style="color: #666; margin-bottom: 1rem;">Run this command in your terminal to submit your current usage:</p>
          <div class="code-block" id="manualCommand">npx ccusage@latest --json | curl -X POST "https://burnrate.autonomoustech.ca/api/usage/submit" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <span class="highlight" id="apiKeyModal1">YOUR_API_KEY</span>" \\
  -d @-</div>
          <p style="color: #999; font-size: 0.85rem;">Replace <strong>YOUR_API_KEY</strong> with your actual API key from registration.</p>
        </div>
        
        <!-- Auto Update Tab -->
        <div id="autoTab" class="tab-content">
          <div class="step">
            <h4>Step 1: Create the hook script</h4>
            <div class="code-block">cat > ~/.claude/hooks/scripts/burnrate.sh << 'EOF'
#!/bin/bash
API_KEY="<span class="highlight" id="apiKeyModal2">YOUR_API_KEY</span>"
API_URL="https://burnrate.autonomoustech.ca/api/usage/submit"

npx ccusage@latest --json | curl -X POST "$API_URL" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $API_KEY" \\
  -d @-

echo "✅ Usage submitted to burnrate"
EOF</div>
          </div>
          
          <div class="step">
            <h4>Step 2: Make it executable</h4>
            <div class="code-block">chmod +x ~/.claude/hooks/scripts/burnrate.sh</div>
          </div>
          
          <div class="step">
            <h4>Step 3: Configure Claude Code hooks</h4>
            <div class="code-block">cat > ~/.claude/settings.json << 'EOF'
{
  "hooks": {
    "SessionEnd": [
      {
        "type": "command",
        "command": "~/.claude/hooks/scripts/burnrate.sh"
      }
    ]
  }
}
EOF</div>
          </div>
          
          <div class="step">
            <h4>Step 4: Test it</h4>
            <div class="code-block">~/.claude/hooks/scripts/burnrate.sh</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Join Leaderboard Modal -->
  <div id="joinModal" class="modal">
    <div class="modal-content" style="max-width: 400px;">
      <div class="modal-header">
        <h2>Create Your Profile</h2>
        <button class="modal-close" onclick="closeJoinModal()">×</button>
      </div>
      <div class="modal-body">
        <p style="color: #666; margin-bottom: 1.5rem;">Choose a username to join the leaderboard.</p>
        
        <form id="joinForm">
          <div class="form-group">
            <label style="color: #333;">Username</label>
            <input type="text" id="joinUsername" placeholder="Enter your username" required style="background: #fff; color: #333; border: 1px solid #ddd;">
          </div>
          <button type="submit" class="btn" style="width: 100%;">Join Leaderboard</button>
        </form>
        <div id="joinResult" style="margin-top: 1rem;"></div>
      </div>
    </div>
  </div>

  <script>
    // Modal controls
    function openUpdateModal() {
      document.getElementById('updateModal').classList.add('active');
    }

    function closeUpdateModal() {
      document.getElementById('updateModal').classList.remove('active');
    }

    function switchTab(tab) {
      // Update tab buttons
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      event.target.classList.add('active');
      
      // Update tab content
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      if (tab === 'manual') {
        document.getElementById('manualTab').classList.add('active');
      } else {
        document.getElementById('autoTab').classList.add('active');
      }
    }

    function openJoinModal() {
      document.getElementById('joinModal').classList.add('active');
    }

    function closeJoinModal() {
      document.getElementById('joinModal').classList.remove('active');
    }

    // Close modal on background click
    document.getElementById('updateModal').addEventListener('click', (e) => {
      if (e.target.id === 'updateModal') {
        closeUpdateModal();
      }
    });

    document.getElementById('joinModal').addEventListener('click', (e) => {
      if (e.target.id === 'joinModal') {
        closeJoinModal();
      }
    });

    // Join Leaderboard
    document.getElementById('joinForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('joinUsername').value;
      
      // Store username in localStorage
      localStorage.setItem('burnrate_username', username);
      
      // Try to update via API if user has an API key
      const apiKey = localStorage.getItem('burnrate_apikey');
      if (apiKey) {
        try {
          const response = await fetch('/api/profile/update', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify({ displayName: username, isPublic: true }),
          });

          if (response.ok) {
            document.getElementById('joinResult').innerHTML = 
              '<p style="color: #4ade80;">✅ Profile updated! You\'re now on the leaderboard.</p>';
          } else {
            document.getElementById('joinResult').innerHTML = 
              '<p style="color: #4ade80;">✅ Username saved locally!</p>' +
              '<p style="color: #666; font-size: 0.9rem; margin-top: 0.5rem;">Register to sync your profile.</p>';
          }
        } catch (error) {
          document.getElementById('joinResult').innerHTML = 
            '<p style="color: #4ade80;">✅ Username saved locally!</p>';
        }
      } else {
        document.getElementById('joinResult').innerHTML = 
          '<p style="color: #4ade80;">✅ Username saved!</p>' +
          '<p style="color: #666; font-size: 0.9rem; margin-top: 0.5rem;">Register and submit usage to appear on the leaderboard.</p>';
      }
      
      setTimeout(() => {
        closeJoinModal();
      }, 2000);
    });

    // Registration
    document.getElementById('registerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const displayName = document.getElementById('displayName').value;

      try {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, displayName: displayName || null }),
        });

        const data = await response.json();

        if (response.ok) {
          // Store API key in localStorage
          localStorage.setItem('burnrate_apikey', data.apiKey);
          
          document.getElementById('result').innerHTML = 
            '<p class="success">✅ API Key generated!</p>' +
            '<div class="code-block" style="color: #333; background: rgba(0,0,0,0.05);">' + data.apiKey + '</div>' +
            '<p style="color: #fef3c7;">⚠️ Save this key - you won\\'t see it again!</p>' +
            '<button class="btn" onclick="openUpdateModal(); updateApiKeyPlaceholders(\\''+data.apiKey+'\\')">View Setup Instructions</button>';
          
          // Scroll to result
          document.getElementById('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
          document.getElementById('result').innerHTML = 
            '<p class="error">❌ ' + data.error + '</p>';
        }
      } catch (error) {
        document.getElementById('result').innerHTML = 
          '<p class="error">❌ Registration failed</p>';
      }
    });

    // Update API key placeholders in modal
    function updateApiKeyPlaceholders(apiKey) {
      document.getElementById('apiKeyModal1').textContent = apiKey;
      document.getElementById('apiKeyModal2').textContent = apiKey;
    }

    // Load leaderboard
    async function loadLeaderboard() {
      try {
        const response = await fetch('/api/leaderboard/daily');
        const data = await response.json();
        
        const html = data.leaderboard.map(item => 
          '<div class="leaderboard-item">' +
          '<span>' + item.rank + '. ' + item.name + '</span>' +
          '<span>' + item.tokens.toLocaleString() + ' tokens ($' + item.cost.toFixed(2) + ')</span>' +
          '</div>'
        ).join('');

        document.getElementById('leaderboardContent').innerHTML = html || '<p>No entries yet - be the first!</p>';
      } catch (error) {
        document.getElementById('leaderboardContent').innerHTML = '<p>Failed to load leaderboard</p>';
      }
    }

    loadLeaderboard();
    setInterval(loadLeaderboard, 30000); // Refresh every 30s
  </script>
</body>
</html>`;
}
