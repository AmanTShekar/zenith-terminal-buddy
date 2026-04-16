import * as vscode from 'vscode';

export function getDashboardHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zenith Command Center</title>
  <style>
    :root {
      --bg: #000000;
      --bg2: #050505;
      --fg: #e0e0e0;
      --fg-dim: #888888;
      --accent: #ffffff;
      --border: #222222;
      --card: #0a0a0a;
      --glass: rgba(255, 255, 255, 0.03);
      --primary: #dcdcdc;
      --success: #00e676;
      --error: #ff4444;
    }

    * { box-sizing: border-box; }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: 'Inter', -apple-system, sans-serif;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* ── Header ─────────────────────────────────── */
    header {
      padding: 24px 40px;
      background: var(--bg2);
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .logo-group { display: flex; align-items: center; gap: 16px; }
    .logo { font-size: 20px; font-weight: 900; letter-spacing: -1px; text-transform: uppercase; color: var(--accent); }
    .tagline { font-size: 11px; color: var(--fg-dim); text-transform: uppercase; letter-spacing: 2px; }

    /* ── Main Layout ────────────────────────────── */
    main {
      flex: 1;
      display: grid;
      grid-template-columns: 350px 1fr 300px;
      gap: 1px;
      background: var(--border);
      overflow: hidden;
    }

    section { background: var(--bg); display: flex; flex-direction: column; overflow: hidden; }
    .sec-hdr { padding: 16px 20px; border-bottom: 1px solid var(--border); background: var(--bg2); display: flex; justify-content: space-between; align-items: center; }
    .sec-title { font-size: 11px; font-weight: 800; color: var(--fg-dim); text-transform: uppercase; letter-spacing: 1.5px; }

    /* ── Jira List ──────────────────────────────── */
    #jira-list { overflow-y: auto; padding: 10px; }
    .ticket-card {
      background: var(--card);
      border: 1px solid var(--border);
      padding: 12px;
      margin-bottom: 10px;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .ticket-card:hover { border-color: var(--accent); background: var(--glass); }
    .t-key { font-size: 10px; font-weight: 800; color: var(--fg-dim); margin-bottom: 4px; }
    .t-summary { font-size: 13px; font-weight: 600; line-height: 1.4; color: var(--accent); }
    .t-status { display: inline-block; margin-top: 8px; font-size: 9px; padding: 2px 6px; background: var(--border); border-radius: 10px; text-transform: uppercase; }

    /* ── Center Content (Lab) ──────────────────── */
    #lab-content { flex: 1; overflow-y: auto; padding: 40px; }
    .hero-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 40px; }
    .hero-stat { background: var(--card); border: 1px solid var(--border); padding: 20px; border-radius: 8px; }
    .hs-label { font-size: 10px; color: var(--fg-dim); text-transform: uppercase; margin-bottom: 8px; }
    .hs-val { font-size: 24px; font-weight: 800; color: var(--accent); }

    /* ── Right Panel (Details) ─────────────────── */
    #details-panel { padding: 20px; }
    .empty-state { height: 100%; display: flex; align-items: center; justify-content: center; color: var(--fg-dim); font-size: 13px; text-align: center; }

    /* ── Controls ───────────────────────────────── */
    .btn {
       background: var(--accent); color: var(--bg); border: none; padding: 8px 16px; 
       font-size: 12px; font-weight: 700; border-radius: 4px; cursor: pointer;
    }
    .btn:hover { opacity: 0.9; }
    .btn-ghost { background: transparent; color: var(--fg); border: 1px solid var(--border); }
    .btn-ghost:hover { border-color: var(--accent); }

    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-thumb { background: var(--border); }
  </style>
</head>
<body>
  <header>
    <div class="logo-group">
      <div class="logo">Zenith Command Center</div>
      <div class="tagline">Mission Control</div>
    </div>
    <div class="actions">
       <button class="btn btn-ghost" id="refresh-btn">Sync Everything</button>
    </div>
  </header>

  <main>
    <!-- Left: Jira -->
    <section>
      <div class="sec-hdr">
        <span class="sec-title">Jira Tickets</span>
        <span id="jira-count" class="tagline">0 Found</span>
      </div>
      <div id="jira-list">
        <div class="empty-state">Scan terminal for Jira IDs...</div>
      </div>
    </section>

    <!-- Center: Lab -->
    <section>
      <div class="sec-hdr">
        <span class="sec-title">Intelligence Lab</span>
      </div>
      <div id="lab-content">
        <div class="hero-stat-grid">
           <div class="hero-stat">
             <div class="hs-label">Active Port</div>
             <div class="hs-val" id="active-port">None</div>
           </div>
           <div class="hero-stat">
             <div class="hs-label">Branch</div>
             <div class="hs-val" id="active-branch">main</div>
           </div>
           <div class="hero-stat">
             <div class="hs-label">Jira Status</div>
             <div class="hs-val" id="jira-connection">Disconnected</div>
           </div>
        </div>

        <div id="ai-insights">
           <h2 style="font-size: 18px; margin-bottom: 20px;">Zenith Insights</h2>
           <div class="empty-state">Ask Zenith in the sidebar to populate lab data...</div>
        </div>
      </div>
    </section>

    <!-- Right: Details -->
    <section>
      <div class="sec-hdr">
        <span class="sec-title">Context Detail</span>
      </div>
      <div id="details-panel">
        <div class="empty-state">Select an item to view deep context</div>
      </div>
    </section>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.getElementById('refresh-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'refreshJira' });
    });

    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.type) {
        case 'jiraStatus':
          const status = document.getElementById('jira-connection');
          status.innerText = message.payload.configured ? 'Connected' : 'Disconnected';
          status.style.color = message.payload.configured ? 'var(--success)' : 'var(--error)';
          break;
        case 'issueDetails':
          updateDetails(message.payload);
          break;
      }
    });

    function updateDetails(issue) {
       const panel = document.getElementById('details-panel');
       panel.innerHTML = \`
         <div style="font-size: 11px; margin-bottom: 8px; color: var(--fg-dim);">\${issue.key}</div>
         <h1 style="font-size: 18px; margin-bottom: 16px;">\${issue.summary}</h1>
         <div class="t-status" style="background: var(--glass); border: 1px solid var(--border);">\${issue.status}</div>
         <div style="margin: 20px 0; font-size: 13px; line-height: 1.6; color: var(--fg);">
           \${issue.description || 'No description provided.'}
         </div>
         <div style="margin-top: 30px; display: flex; flex-direction: column; gap: 10px;">
           <button class="btn" style="width: 100%;">Transition Issue</button>
           <button class="btn btn-ghost" style="width: 100%;">Copy Branch Name</button>
         </div>
       \`;
    }
  </script>
</body>
</html>`;
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
