/**
 * Utility to mask common sensitive patterns (API keys, tokens, secrets) 
 * from terminal command strings and outputs before they are persisted or shared.
 */

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // Generic Bearer/JWT tokens
  { name: 'Bearer Token', pattern: /bearer\s+[a-zA-Z0-9\-\._~+\/]{20,}/gi },
  
  // AWS Keys
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/g },
  // Context-aware: only match when preceded by the key variable name
  { name: 'AWS Secret Access Key', pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)[\s=:"']+([a-zA-Z0-9\/+]{40})/g },
  
  // GitHub / GitLab Tokens
  { name: 'GitHub Token', pattern: /gh[pousr]_[a-zA-Z0-9]{36,}/g },
  { name: 'GitLab Token', pattern: /glpat-[a-zA-Z0-9\-]{20,}/g },
  
  // OpenAI / Anthropic / Gemini Key formats
  { name: 'OpenAI API Key', pattern: /sk-[a-zA-Z0-9]{32,}/g },
  { name: 'Anthropic API Key', pattern: /sk-ant-(?:api\d{2})?-[a-zA-Z0-9\-]{40,}/g },
  { name: 'Gemini/Google Key', pattern: /AIzaSy[a-zA-Z0-9\-_]{33}/g },
  { name: 'Groq API Key', pattern: /gsk_[a-zA-Z0-9]{32,}/g },
  
  // Common connection strings
  { name: 'MongoDB URI', pattern: /mongodb(?:\+srv)?:\/\/[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+/gi },
  { name: 'PostgreSQL URI', pattern: /postgres:\/\/[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+/gi },
  
  // Private SSH keys (start markers only, to avoid leaking full key context)
  { name: 'SSH Private Key', pattern: /-----BEGIN (?:RSA|OPENSSH|DSA|EC) PRIVATE KEY-----[\s\S]*?-----END (?:RSA|OPENSSH|DSA|EC) PRIVATE KEY-----/g },
  
  // Generic high-entropy strings (Generic Key)
  { name: 'Generic Secret', pattern: /(?:api[-_]?key|secret|password|passwd|token)\s*[:=]\s*["']?([a-zA-Z0-9\-._~]{10,})["']?/gi },

  // [NEW] v5 Patterns
  { name: 'Stripe Key', pattern: /(?:sk|pk)_(?:test|live)_[0-9a-zA-Z]{24,}/g },
  { name: 'Slack Token', pattern: /xox[baprs]-[0-9a-zA-Z]{10,}-?[0-9a-zA-Z]{10,}-?[0-9a-zA-Z]{10,}/g },
  { name: 'Heroku API Key', pattern: /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g },
  { name: 'Firebase Config', pattern: /apiKey:\s*["'](AIzaSy[a-zA-Z0-9\-_]{33})["']/gi },
];

/**
 * Main redaction entry point.
 */
export function redact(text: string): string {
  if (!text) { return text; }
  
  let redacted = text;
  
  // First, redact inline environment variable assignments like DB_PASS=secret
  redacted = redactEnv(redacted);
  
  for (const { pattern, name } of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match, p1) => {
      // If p1 (capture group) exists, redact it.
      if (p1) {
        return match.replace(p1, `[REDACTED_${name.replace(/\s+/g, '_').toUpperCase()}]`);
      }
      return `[REDACTED_${name.replace(/\s+/g, '_').toUpperCase()}]`;
    });
  }
  
  return redacted;
}

/**
 * Specifically targets "KEY=VALUE" patterns in command lines.
 */
function redactEnv(cmd: string): string {
  const ENV_PATTERN = /(?:^|\s)([A-Z_0-9]+)=(['"]?)([a-zA-Z0-9\-_.~+]{8,})\2/g;
  const PROTECTED_KEYS = new Set(['NODE_ENV', 'PATH', 'PORT', 'USER', 'LANG', 'SHELL', 'EDITOR', 'TERM']);

  return cmd.replace(ENV_PATTERN, (match, key, quote, value) => {
    if (PROTECTED_KEYS.has(key)) {
      return match;
    }
    // Only redact if the value looks like a secret/key (too long or messy)
    // or if the key name explicitly sounds sensitive.
    const isSensitiveKey = /(KEY|SECRET|PASS|TOKEN|CRED|AUTH|SIGNATURE)/i.test(key);
    if (isSensitiveKey || value.length > 20) {
      return ` ${key}=${quote}[REDACTED_ENV_VAR]${quote}`;
    }
    return match;
  });
}
