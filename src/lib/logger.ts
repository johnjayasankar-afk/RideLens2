type LogLevel = "info" | "warn" | "error";

const SECRET_KEYS = [
  "api_key",
  "apikey",
  "authorization",
  "password",
  "secret",
  "token",
  "service_role",
];

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, inner]) => {
      if (SECRET_KEYS.some((secret) => key.toLowerCase().includes(secret))) {
        return [key, "[redacted]"];
      }
      return [key, redact(inner)];
    });
    return Object.fromEntries(entries);
  }
  return value;
}

function write(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...((redact(fields) as Record<string, unknown>) ?? {}),
  });
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.info(line);
}

export const logger = {
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
};
