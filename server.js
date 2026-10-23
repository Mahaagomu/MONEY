'use strict';

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;
const origins = (process.env.FRONTEND_ORIGINS || 'https://mahaagomu.github.io')
  .split(',').map(s => s.trim()).filter(Boolean);

app.set('trust proxy', 1);
app.use(cors({
  origin(origin, callback) {
    // Requests from ESP8266 and command-line health checks have no Origin header.
    if (!origin || origins.includes('*') || origins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-device-key']
}));
app.use(express.json({ limit: '10kb' }));

let latest = {
  status: 'DANGEROUS',
  reason: 'No website has been verified yet. Do not pay until a check completes.',
  checkedUrl: '',
  hostname: '',
  checkedAt: null,
  verification: 'not_checked'
};

function saveDanger(reason, inputUrl = '') {
  let hostname = '';
  try { hostname = new URL(inputUrl).hostname; } catch (_) {}
  latest = {
    status: 'DANGEROUS', reason, checkedUrl: inputUrl.slice(0, 2048), hostname,
    checkedAt: new Date().toISOString(), verification: 'failed_or_unsafe'
  };
  return latest;
}

function parsePublicHttpUrl(input) {
  if (typeof input !== 'string' || input.length < 8 || input.length > 2048) {
    throw new Error('Enter a valid website URL (maximum 2048 characters).');
  }
  let parsed;
  try { parsed = new URL(input.trim()); }
  catch (_) { throw new Error('That URL format is invalid. Include https:// or http://.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http:// and https:// website links can be checked.');
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new Error('This URL has no valid hostname or contains embedded login credentials.');
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host === '::1' || host === '0.0.0.0' || /^127\./.test(host) ||
      /^10\./.test(host) || /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw new Error('Local/private network addresses cannot be checked by this project.');
  }
  return parsed;
}

const shortenerHosts = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'is.gd', 'cutt.ly', 'rb.gy', 'rebrand.ly', 'shorturl.at'
]);

function localRiskReason(parsed) {
  const host = parsed.hostname.toLowerCase();
  if (host.startsWith('xn--') || host.includes('.xn--')) {
    return 'The domain uses an internationalized/punycode name. Verify the exact domain before paying.';
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) {
    return 'The link uses an IP address instead of a normal domain. Do not pay until independently verified.';
  }
  if (shortenerHosts.has(host)) {
    return 'This is a shortened link that hides the destination. Do not pay through it until the final domain is verified.';
  }
  return '';
}

async function checkWithGoogleSafeBrowsing(url) {
  const apiKey = process.env.SAFE_BROWSING_API_KEY;
  if (!apiKey) {
    return {
      status: 'DANGEROUS',
      reason: 'Security lookup is not configured on the public server, so this link could not be verified. Do not pay.',
      verification: 'unavailable'
    };
  }

  const endpoint = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        client: { clientId: 'trust-link-check-student-demo', clientVersion: '1.0.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url }]
        }
      })
    });
    if (!response.ok) {
      // Fail closed: a failed security lookup is not proof that a link is safe.
      return {
        status: 'DANGEROUS',
        reason: `Security lookup service returned HTTP ${response.status}; the link could not be verified. Do not pay.`,
        verification: 'unavailable'
      };
    }
    const data = await response.json();
    if (Array.isArray(data.matches) && data.matches.length > 0) {
      const threats = [...new Set(data.matches.map(m => m.threatType).filter(Boolean))].join(', ');
      return {
        status: 'DANGEROUS',
        reason: `The link matched a known unsafe-web threat list${threats ? ` (${threats})` : ''}. Do not pay.`,
        verification: 'threat_match'
      };
    }
    return {
      status: 'SAFE',
      reason: 'No known unsafe-web match was found in this lookup. This is not a guarantee that the website or payment is safe.',
      verification: 'no_known_match'
    };
  } catch (error) {
    return {
      status: 'DANGEROUS',
      reason: 'The security lookup could not be completed (network or timeout). Treat the link as unverified and do not pay.',
      verification: 'unavailable'
    };
  } finally {
    clearTimeout(timeout);
  }
}

// Small in-memory limit for the demo API: max 20 checks per IP in a rolling minute.
const checkBuckets = new Map();
function checkRateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || 'unknown';
  const bucket = checkBuckets.get(key) || [];
  const recent = bucket.filter(ts => now - ts < 60000);
  if (recent.length >= 20) return res.status(429).json({ error: 'Too many checks. Please wait one minute and try again.' });
  recent.push(now);
  checkBuckets.set(key, recent);
  next();
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'Trust Link Check API' }));

app.post('/api/check', checkRateLimit, async (req, res) => {
  const input = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  let parsed;
  try {
    parsed = parsePublicHttpUrl(input);
  } catch (error) {
    const result = saveDanger(error.message, input);
    return res.json(result);
  }

  const heuristic = localRiskReason(parsed);
  let verdict;
  if (heuristic) {
    verdict = { status: 'DANGEROUS', reason: heuristic, verification: 'caution_rule' };
  } else {
    verdict = await checkWithGoogleSafeBrowsing(parsed.href);
  }

  latest = {
    status: verdict.status,
    reason: verdict.reason,
    checkedUrl: parsed.href.slice(0, 2048),
    hostname: parsed.hostname,
    checkedAt: new Date().toISOString(),
    verification: verdict.verification
  };
  return res.json(latest);
});

app.get('/api/latest', (_req, res) => res.json(latest));

app.get('/api/device/latest', (req, res) => {
  const expectedKey = process.env.DEVICE_KEY;
  if (!expectedKey) return res.status(503).json({ error: 'DEVICE_KEY is not configured on the server.' });
  if (req.get('x-device-key') !== expectedKey) return res.status(401).json({ error: 'Invalid device key.' });
  return res.json(latest);
});

app.use((error, _req, res, _next) => {
  if (error && error.message === 'Origin is not allowed by CORS') {
    return res.status(403).json({ error: 'This website origin is not allowed by the API.' });
  }
  console.error(error);
  return res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Trust Link Check API listening on port ${PORT}`);
});
