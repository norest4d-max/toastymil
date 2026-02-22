function clampLevel(level) {
  const levels = ["low", "medium", "high"];
  return levels.includes(level) ? level : "low";
}

function maxLevel(a, b) {
  const rank = { low: 0, medium: 1, high: 2 };
  return rank[a] >= rank[b] ? a : b;
}

function redactWith(pattern, text, replacement) {
  return text.replace(pattern, replacement);
}

export function assessRisk(text) {
  const input = String(text || "");
  let level = "low";
  const reasons = [];
  let redacted = input;

  // Emails
  const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  if (emailRe.test(input)) {
    level = maxLevel(level, "medium");
    reasons.push("email address");
    redacted = redactWith(emailRe, redacted, "[REDACTED_EMAIL]");
  }

  // Phone-ish (very rough)
  const phoneRe = /\b(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
  if (phoneRe.test(input)) {
    level = maxLevel(level, "medium");
    reasons.push("phone number");
    redacted = redactWith(phoneRe, redacted, "[REDACTED_PHONE]");
  }

  // IP addresses
  const ipRe = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
  if (ipRe.test(input)) {
    level = maxLevel(level, "medium");
    reasons.push("IP address");
    redacted = redactWith(ipRe, redacted, "[REDACTED_IP]");
  }

  // API keys / tokens (common patterns)
  const bearerRe = /\bBearer\s+[A-Za-z0-9._-]+\b/g;
  if (bearerRe.test(input)) {
    level = maxLevel(level, "high");
    reasons.push("bearer token");
    redacted = redactWith(bearerRe, redacted, "Bearer [REDACTED_TOKEN]");
  }

  const awsAccessKeyRe = /\bAKIA[0-9A-Z]{16}\b/g;
  if (awsAccessKeyRe.test(input)) {
    level = maxLevel(level, "high");
    reasons.push("AWS access key");
    redacted = redactWith(awsAccessKeyRe, redacted, "[REDACTED_AWS_KEY]");
  }

  const privateKeyRe = /-----BEGIN ([A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END ([A-Z ]+ )?PRIVATE KEY-----/g;
  if (privateKeyRe.test(input)) {
    level = maxLevel(level, "high");
    reasons.push("private key material");
    redacted = redactWith(privateKeyRe, redacted, "[REDACTED_PRIVATE_KEY]");
  }

  // Password-like assignment
  const passwordRe = /\b(pass(word)?|pwd|secret|token|api[_-]?key)\b\s*[:=]\s*[^\s]+/gi;
  if (passwordRe.test(input)) {
    level = maxLevel(level, "high");
    reasons.push("credential-like assignment");
    redacted = redactWith(passwordRe, redacted, (m) => {
      const k = m.split(/[:=]/)[0];
      return `${k}: [REDACTED]`;
    });
  }

  // Windows user path (personal identifier-ish)
  const userPathRe = /\b[A-Z]:\\Users\\[^\\\s]+/gi;
  if (userPathRe.test(input)) {
    level = maxLevel(level, "medium");
    reasons.push("user home path");
    redacted = redactWith(userPathRe, redacted, "[REDACTED_USER_PATH]");
  }

  return {
    level: clampLevel(level),
    reasons: Array.from(new Set(reasons)),
    redactedText: redacted,
  };
}
