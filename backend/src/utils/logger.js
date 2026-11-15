// Tiny structured logger. Swap for pino/winston later without touching callers.
const stamp = () => new Date().toISOString();
const write = (level, scope, message, extra) => {
  const line = `${stamp()} ${level.padEnd(5)} [${scope}] ${message}`;
  const out = level === 'ERROR' ? console.error : console.log;
  extra === undefined ? out(line) : out(line, extra);
};

export const createLogger = (scope) => ({
  info: (message, extra) => write('INFO', scope, message, extra),
  warn: (message, extra) => write('WARN', scope, message, extra),
  error: (message, extra) => write('ERROR', scope, message, extra),
});
