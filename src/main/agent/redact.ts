// Secret redaction for tool outputs, evidence, and trace exports.
// Catches common API key / token patterns and replaces them with [REDACTED].

const KNOWN_KEY_PATTERNS: RegExp[] = [
  /\bsk-[a-zA-Z0-9]{20,}\b/g,    // OpenAI API key
  /\bsk-ant-[a-zA-Z0-9-]{20,}\b/g, // Anthropic API key
  /\bghp_[a-zA-Z0-9]{30,}\b/g,     // GitHub personal access token
  /\bgho_[a-zA-Z0-9]{36}\b/g,     // GitHub OAuth token
  /\bghu_[a-zA-Z0-9]{36}\b/g,     // GitHub user-to-server token
  /\bghs_[a-zA-Z0-9]{36}\b/g,     // GitHub server-to-server token
  /\bghr_[a-zA-Z0-9]{36}\b/g,     // GitHub refresh token
  /\bxox[bpras]-[a-zA-Z0-9-]+\b/g, // Slack token
  /\bhf_[a-zA-Z0-9]{34}\b/g,      // HuggingFace token
  /\bglpat-[a-zA-Z0-9-]+\b/g,     // GitLab personal access token
  /\bAKIA[0-9A-Z]{16}\b/g,        // AWS access key ID
]

const GENERIC_ASSIGNMENT_PATTERN = /(?:api[_-]?key|token|secret|password|credential|private[_-]?key)s?\s*[:=]\s*(\S+)/gi

export function redactSecrets(text: string): string {
  let redacted = text
  for (const pattern of KNOWN_KEY_PATTERNS) {
    redacted = redacted.replace(pattern, match => `[REDACTED:${match.slice(0, 4)}...]`)
  }
  redacted = redacted.replace(GENERIC_ASSIGNMENT_PATTERN, (_full, value) => {
    if (value.length < 5) return _full
    return _full.replace(value, '[REDACTED]')
  })
  return redacted
}
