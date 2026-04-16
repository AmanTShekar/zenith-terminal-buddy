export function getPanelContent(): string {
  return `
  <div id="warn-bar" style="display:none;"></div>
  
  <div id="hdr">
    <div class="logo">Terminal Buddy</div>
    <div id="ai-badge" data-action="setApiKey">
      <div id="ai-status-dot"></div>
      <div id="ai-status-text">AI Initializing...</div>
    </div>
    <div id="zenith-center-btn" title="Open Zenith Command Center" style="cursor:pointer; font-size:16px;">🏢</div>
  </div>

  <div id="pet">
    <div id="pet-emoji">🥚</div>
    <div id="pet-info">
      <div id="pet-row">
        <span id="pet-name">Buddy</span>
        <span id="pet-lv">Lv.1</span>
      </div>
      <div id="pet-mood">Hatching...</div>
      <div id="xp-track"><div id="xp-fill"></div></div>
    </div>
  </div>

  <div id="stats-bar">
    <div class="st-item" id="st-ok"><span class="st-val">0</span><span class="st-label">Success</span></div>
    <div class="st-item" id="st-err"><span class="st-val">0</span><span class="st-label">Errors</span></div>
    <div class="st-item" id="st-total"><span class="st-val">0</span><span class="st-label">Total</span></div>
  </div>

  <div id="tabs">
    <div class="tab active" data-action="tab" data-tab="chat">Chat</div>
    <div class="tab" data-action="tab" data-tab="log">Logs</div>
    <div class="tab" data-action="tab" data-tab="live">Live</div>
    <div class="tab" data-action="tab" data-tab="explorer">Explorer</div>
    <div class="tab" data-action="tab" data-tab="ports">Ports</div>
    <div class="tab" data-action="tab" data-tab="jira">Jira</div>
    <div class="tab" data-action="tab" data-tab="git">Git</div>
    <div class="tab" data-action="tab" data-tab="pkgs">Pkgs</div>
    <div class="tab" data-action="tab" data-tab="vault">Vault <span class="badge-exp">EXP</span></div>
    <div class="tab" data-action="tab" data-tab="usage">Usage</div>
    <div class="tab" data-action="tab" data-tab="settings">Settings</div>
  </div>

  <div id="panels">
    <!-- Chat Panel -->
    <div id="panel-chat" class="panel active">
      <div id="chat-msgs" class="scroll">
        <div class="msg buddy">👋 Hi! I'm Buddy. Ask me anything about your terminal or workspace.</div>
      </div>
      <div class="ai-mover">
        <input type="text" id="ai-mover-input" class="ai-mover-input" placeholder="Quick move: 'go to src' or 'find controllers'..." />
      </div>
      <div id="chat-input-area">
        <textarea id="chat-input" placeholder="Ask Buddy..." rows="1"></textarea>
        <button id="send-btn">🚀</button>
      </div>
    </div>

    <!-- Logs Panel -->
    <div id="panel-log" class="panel">
      <div class="log-filter-bar">
        <input type="text" id="log-search" placeholder="Filter commands..." />
        <button id="filter-toggle-btn">🔍</button>
      </div>
      <div id="log-filters-box" class="log-filters">
        <select id="term-filter" class="filter-select"><option value="all">All Terminals</option></select>
        <select id="status-filter" class="filter-select">
          <option value="all">All Status</option>
          <option value="ok">Success</option>
          <option value="error">Errors</option>
        </select>
        <select id="project-filter" class="filter-select"><option value="all">All Projects</option></select>
        <select id="sort-filter" class="filter-select">
          <option value="desc">Newest First</option>
          <option value="asc">Oldest First</option>
        </select>
      </div>
      <div id="log-list" class="scroll"></div>
    </div>

    <!-- Live Panel -->
    <div id="panel-live" class="panel">
      <div id="live-list" class="scroll"></div>
      <div class="terminal-selector">
        <div class="git-tree-header">Active Terminals</div>
        <div id="terminal-selector"></div>
      </div>
    </div>

    <!-- Explorer Panel -->
    <div id="panel-explorer" class="panel">
      <div id="explorer-tree" class="scroll"></div>
    </div>

    <!-- Ports Panel -->
    <div id="panel-ports" class="panel">
      <div id="ports-list" class="scroll"></div>
    </div>

    <!-- Git Panel -->
    <div id="panel-git" class="panel">
      <div id="git-status" class="scroll"></div>
    </div>

    <!-- Jira Panel -->
    <div id="panel-jira" class="panel">
      <div id="jira-active-ticket" class="jira-ticket-container">
        <div class="empty-state">No active ticket detected.</div>
      </div>
      <div class="jira-quick-actions">
         <button class="btn btn-ghost" data-action="openZenithCenter">Open Full Command Center</button>
      </div>
    </div>
    <div id="panel-git" class="panel">
      <div id="git-content" class="scroll"></div>
    </div>

    <!-- Pkgs Panel -->
    <div id="panel-pkgs" class="panel">
      <div id="pkgs-list" class="scroll"></div>
    </div>

    <!-- Vault Panel -->
    <div id="panel-vault" class="panel">
      <div class="scroll">
         <div class="vault-header">
           <div class="v-title">Terminal Vault <span class="badge-exp">EXPERIMENTAL</span></div>
           <p class="sub-text-tiny">Securely manage and inject service keys into your terminal. This feature is currently in beta.</p>
         </div>
         <div id="vault-list"></div>
         <div class="vault-add-box">
            <input type="text" id="vault-new-name" placeholder="Service Name (e.g. Hugging Face)" />
            <input type="text" id="vault-new-env" placeholder="Env Var (e.g. HF_TOKEN)" />
            <button id="vault-add-btn">Add Service</button>
         </div>
      </div>
    </div>

    <!-- Usage Panel -->
    <div id="panel-usage" class="panel">
      <div class="scroll">
         <div class="usage-summary-card">
           <div class="u-title">Total AI Usage</div>
           <div class="u-val" id="usage-total-cost">$0.00</div>
           <div class="u-sub" id="usage-total-tokens">0 tokens</div>
         </div>
         <div id="usage-provider-list"></div>
         <button class="u-clear-btn" data-action="clearUsage">Clear History</button>
      </div>
    </div>

    <!-- Settings Panel -->
    <div id="panel-settings" class="panel">
      <div class="scroll">
        <div class="settings-group">
          <div class="settings-header">🤖 AI Manager</div>
          <div class="provider-grid">
            <div class="provider-card" id="card-gemini" data-action="selectProvider" data-id="gemini">
              <div class="card-header">
                <span class="p-icon">💎</span>
                <span class="p-name">Gemini</span>
                <span class="p-status" id="status-gemini">Ready</span>
              </div>
              <div class="card-body">
                <input type="password" class="p-key" id="key-gemini" data-provider="gemini" placeholder="Enter API Key" />
              </div>
            </div>
            <div class="provider-card" id="card-openai" data-action="selectProvider" data-id="openai">
              <div class="card-header">
                <span class="p-icon">❤️</span>
                <span class="p-name">OpenAI</span>
                <span class="p-status" id="status-openai">Off</span>
              </div>
              <div class="card-body">
                <input type="password" class="p-key" id="key-openai" data-provider="openai" placeholder="Enter API Key" />
              </div>
            </div>
            <div class="provider-card" id="card-claude" data-action="selectProvider" data-id="claude">
              <div class="card-header">
                <span class="p-icon">🎭</span>
                <span class="p-name">Claude</span>
                <span class="p-status" id="status-claude">Off</span>
              </div>
              <div class="card-body">
                <input type="password" class="p-key" id="key-claude" data-provider="claude" placeholder="Enter API Key" />
              </div>
            </div>
            <div class="provider-card" id="card-groq" data-action="selectProvider" data-id="groq">
              <div class="card-header">
                <span class="p-icon">⚡</span>
                <span class="p-name">Groq</span>
                <span class="p-status" id="status-groq">Off</span>
              </div>
              <div class="card-body">
                <input type="password" class="p-key" id="key-groq" data-provider="groq" placeholder="Enter API Key" />
              </div>
            </div>
            <div class="provider-card" id="card-ollama" data-action="selectProvider" data-id="ollama">
              <div class="card-header">
                <span class="p-icon">🏠</span>
                <span class="p-name">Ollama</span>
                <span class="p-status" id="status-ollama" data-custom="true">Local</span>
              </div>
            </div>
            <div class="provider-card" id="card-zai" data-action="selectProvider" data-id="zai">
              <div class="card-header">
                <span class="p-icon">🎋</span>
                <span class="p-name">Z.AI</span>
                <span class="p-status" id="status-zai">Off</span>
              </div>
              <div class="card-body">
                <input type="password" class="p-key" id="key-zai" data-provider="zai" placeholder="Enter API Key" />
              </div>
            </div>
            <div class="provider-card" id="card-minimax" data-action="selectProvider" data-id="minimax">
              <div class="card-header">
                <span class="p-icon">🗻</span>
                <span class="p-name">MiniMax</span>
                <span class="p-status" id="status-minimax">Off</span>
              </div>
              <div class="card-body">
                <input type="password" class="p-key" id="key-minimax" data-provider="minimax" placeholder="Enter API Key" />
              </div>
            </div>
            <div class="provider-card" id="card-custom" data-action="selectProvider" data-id="custom">
              <div class="card-header">
                <span class="p-icon">🌐</span>
                <span class="p-name">Custom</span>
                <span class="p-status" id="status-custom" data-custom="true">Proxy</span>
              </div>
            </div>
          </div>
          
          <div class="settings-row-modern" id="row-endpoint" style="display:none;">
            <label>Custom Endpoint</label>
            <input type="text" id="setting-endpoint" placeholder="http://localhost:11434/v1" />
          </div>
          <div class="settings-row-modern" id="row-api-key" style="display:none;">
             <p class="sub-text-tiny" style="margin-top:8px;">Detected keys will be automatically moved to provider cards.</p>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-header">⚙️ System Configuration</div>
          <div class="settings-card">
            <div class="settings-row-v2">
              <div class="s-v2-info">
                <div class="s-v2-label">🔘 Master Switch</div>
                <div class="sub-text-tiny">Toggle all Terminal Buddy features globally.</div>
              </div>
              <label class="switch">
                <input type="checkbox" id="setting-enabled">
                <span class="slider round"></span>
              </label>
            </div>
            <div class="settings-row-v2">
              <div class="s-v2-info">
                <div class="s-v2-label">⚡ Auto-Run Suggestions <span class="badge-caution">CAUTION</span></div>
                <div class="sub-text-tiny">Automatically execute AI suggestions without confirmation. Use with care.</div>
              </div>
              <label class="switch">
                <input type="checkbox" id="setting-autoRunSuggestions">
                <span class="slider round"></span>
              </label>
            </div>
            <div class="settings-row-v2">
              <div class="s-v2-info">
                <div class="s-v2-label">🔒 Auto-Inject Vault Keys <span class="badge-exp">BETA</span></div>
                <div class="sub-text-tiny">Automatically push secrets into new terminals.</div>
              </div>
              <label class="switch">
                <input type="checkbox" id="setting-autoInjectEnvVars">
                <span class="slider round"></span>
              </label>
            </div>
            <div class="settings-row-v2">
              <div class="s-v2-info">
                <div class="s-v2-label">🕵️‍♂️ Auth Detection <span class="badge-exp">BETA</span></div>
                <div class="sub-text-tiny">Intelligent detection for auth/token prompts.</div>
              </div>
              <label class="switch">
                <input type="checkbox" id="setting-enableAuthDetection">
                <span class="slider round"></span>
              </label>
            </div>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-header">🐾 Companion Settings</div>
          <div class="settings-card">
            <div class="settings-row-v2">
              <div class="s-v2-info">
                <div class="s-v2-label">🐱 Enable Pet</div>
                <div class="sub-text-tiny">Show your companion on the dashboard.</div>
              </div>
              <label class="switch">
                <input type="checkbox" id="setting-petEnabled">
                <span class="slider round"></span>
              </label>
            </div>
            <div class="settings-row-v2 stack">
              <div class="s-v2-label">🧬 Pet Species</div>
              <select id="setting-petType" class="filter-select modern">
                <option value="cat">Cat 🐱</option>
                <option value="dog">Dog 🐶</option>
                <option value="robot">Robot 🤖</option>
                <option value="ghost">Ghost 👻</option>
                <option value="capy">Capybara 🐹</option>
              </select>
            </div>
            <div class="settings-row-v2 stack">
              <div class="s-v2-label">🏷️ Companion Name</div>
              <input type="text" id="setting-petName" class="modern-input" placeholder="Buddy" />
            </div>
          </div>
        </div>

        <div class="footer-box">Terminal Buddy — v0.4.1-stable</div>
      </div>
    </div>
  </div>

  <div id="safety-overlay" class="safety-overlay">
    <div class="s-box">
      <div class="s-icon">⚠️</div>
      <div class="s-title">Safety Check</div>
      <div id="safety-msg">This command might be dangerous.</div>
      <div id="safety-cmd-preview"></div>
      <div class="s-btns">
        <button id="s-cancel" class="s-btn">Cancel</button>
        <button id="s-run" class="s-btn">Run Anyway</button>
      </div>
    </div>
  </div>
  `;
}
