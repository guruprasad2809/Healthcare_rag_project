// Optional password protection (HTTP Basic auth), switched on by setting APP_PASSWORD.
// Without it, anyone who can reach the server could upload or delete documents and
// spend the Gemini quota, so always set it on a public deployment.
import crypto from 'node:crypto';

const safeEqual = (a, b) => {
  const left = crypto.createHash('sha256').update(a).digest();
  const right = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(left, right);
};

/** @param {{username: string, password: string}} auth  empty password = no protection */
export function basicAuth(auth) {
  if (!auth?.password) return (req, res, next) => next();
  return (req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      const username = decoded.slice(0, separator);
      const password = decoded.slice(separator + 1);
      if (separator > -1 && safeEqual(username, auth.username) && safeEqual(password, auth.password)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Healthcare RAG", charset="UTF-8"');
    return res.status(401).json({ error: 'Login required.' });
  };
}
