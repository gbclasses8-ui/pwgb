import express from 'express';
import https from 'node:https';
import type http from 'node:http';
import zlib from 'node:zlib';
import path from 'node:path';
import fs from 'node:fs';

const app = express();
const TARGET_HOST = 'www.learnxpw.site';
const TARGET_ORIGIN = `https://${TARGET_HOST}`;

// Brand settings configured as requested
const BRAND_NAME = 'GB STUDY';
const TELEGRAM_URL = 'https://t.me/GBFreestudy';
const ICON_URL = 'https://i.ibb.co/Q3g9fGSt/1791541921524.png';
const OLD_ICON_URL = 'https://i.ibb.co/V8CbjrG/image.png';
const OLD_TG_URL = 'https://t.me/+AgMz8cG-x8VmNGY1';
const OLD_TG_URL_ALT = 'https://t.me/AgMz8cG-x8VmNGY1';

/**
 * Transforms text responses (HTML, Next.js RSC, JS bundles, API JSON)
 * replacing Name -> GB STUDY, Telegram -> https://t.me/GBFreestudy, Icon -> https://ibb.co/0R7qc34v (direct image)
 */
function transformText(content: string): string {
  let text = content;

  // 1. Strip absolute hostnames so all links stay within this proxy
  text = text.replaceAll('https://www.learnxpw.site', '');
  text = text.replaceAll('http://www.learnxpw.site', '');
  text = text.replaceAll('https:\\/\\/www.learnxpw.site', '');
  text = text.replaceAll('https://learnxpw.site', '');
  text = text.replaceAll('http://learnxpw.site', '');
  text = text.replaceAll('https:\\/\\/learnxpw.site', '');

  // 2. Icon replacement (both direct URL and JSON-escaped slashes, plus path suffix)
  text = text.replaceAll(OLD_ICON_URL, ICON_URL);
  text = text.replaceAll('https:\\/\\/i.ibb.co\\/V8CbjrG\\/image.png', ICON_URL.replace(/\//g, '\\/'));
  text = text.replaceAll('V8CbjrG/image.png', 'Q3g9fGSt/1791541921524.png');
  text = text.replaceAll('V8CbjrG\\/image.png', 'Q3g9fGSt\\/1791541921524.png');
  text = text.replaceAll('https://ibb.co/0R7qc34v', ICON_URL);
  text = text.replaceAll('https:\\/\\/ibb.co\\/0R7qc34v', ICON_URL.replace(/\//g, '\\/'));

  // 3. Telegram URL replacement (both full URL, path, and split tokens)
  text = text.replaceAll(OLD_TG_URL, TELEGRAM_URL);
  text = text.replaceAll('https:\\/\\/t.me\\/+AgMz8cG-x8VmNGY1', TELEGRAM_URL.replace(/\//g, '\\/'));
  text = text.replaceAll(OLD_TG_URL_ALT, TELEGRAM_URL);
  text = text.replaceAll('https:\\/\\/t.me\\/AgMz8cG-x8VmNGY1', TELEGRAM_URL.replace(/\//g, '\\/'));
  text = text.replaceAll('://t.me/+AgMz8cG-x8VmNGY1', '://t.me/GBFreestudy');
  text = text.replaceAll(':\\/\\/t.me\\/+AgMz8cG-x8VmNGY1', ':\\/\\/t.me\\/GBFreestudy');
  text = text.replaceAll('+AgMz8cG-x8VmNGY1', 'GBFreestudy');
  text = text.replaceAll('AgMz8cG-x8VmNGY1', 'GBFreestudy');
  text = text.replaceAll('@bookverse_probot', '@GBFreestudy');

  // 4. Name replacement
  text = text.replaceAll('"webName":"Learnxpw"', `"webName":"${BRAND_NAME}"`);
  text = text.replaceAll('"sidebarTitle":"Learnxpw"', `"sidebarTitle":"${BRAND_NAME}"`);
  text = text.replaceAll('Learnxpw — a comprehensive online study platform', `${BRAND_NAME} — a comprehensive online study platform`);
  text = text.replaceAll('<title>Learnxpw</title>', `<title>${BRAND_NAME}</title>`);
  text = text.replaceAll('© 2026 Learnxpw', `© 2026 ${BRAND_NAME}`);
  text = text.replaceAll('© 2025 Learnxpw', `© 2025 ${BRAND_NAME}`);
  text = text.replaceAll('Learnxpw', BRAND_NAME);
  text = text.replaceAll('LEARNXPW', BRAND_NAME);
  text = text.replaceAll('learnxpw', BRAND_NAME);

  return text;
}

// Serve locally cached logo if requested
app.get('/logo.png', (_req, res) => {
  const localLogo = path.resolve(process.cwd(), 'public', 'logo.png');
  if (fs.existsSync(localLogo)) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(localLogo).pipe(res);
  } else {
    res.redirect(ICON_URL);
  }
});

// Root path handler: directly redirect to /study/batches so the user lands straight on the batches page
app.get('/', (req, res) => {
  if (req.query.home === '1') {
    handleProxy(req, res, '/');
  } else {
    res.redirect(307, '/study/batches');
  }
});

// Helper to determine exact destination path (handles local dev and Vercel serverless rewrites)
function resolvePath(req: express.Request): string {
  let target = req.originalUrl || req.url || '/';
  const matched = (req.headers['x-matched-path'] as string) || '';
  if (matched && !matched.startsWith('/api/index') && matched !== '/api') {
    const qIndex = target.indexOf('?');
    const queryString = qIndex !== -1 ? target.slice(qIndex) : '';
    target = matched.includes('?') ? matched : `${matched}${queryString}`;
  }
  return target;
}

// Proxy handler for all requests
function handleProxy(req: express.Request, res: express.Response, overridePath?: string) {
  const targetPath = overridePath || resolvePath(req);
  const targetUrl = new URL(targetPath, TARGET_ORIGIN);

  // Construct intelligent Referer header
  let refererHeader = `${TARGET_ORIGIN}/`;
  const incomingReferer = (req.headers['referer'] as string) || '';

  if (incomingReferer) {
    try {
      const u = new URL(incomingReferer);
      u.protocol = 'https:';
      u.host = TARGET_HOST;
      refererHeader = u.toString();
    } catch {
      refererHeader = `${TARGET_ORIGIN}/`;
    }
  }

  // Critical requirement: /api/video-url requires exact watch path referer with query params
  if (targetPath.startsWith('/api/video-url')) {
    const q = targetUrl.searchParams;
    const batchId = q.get('batch_id') || q.get('batchId') || '';
    const subjectId = q.get('subject_id') || q.get('subjectId') || '';
    const videoId = q.get('video_id') || q.get('videoId') || q.get('childId') || '';
    refererHeader = `${TARGET_ORIGIN}/watch?batchId=${batchId}&SubjectId=${subjectId}&ContentId=${videoId}`;
  }

  const forwardHeaders: http.OutgoingHttpHeaders = {
    ...req.headers,
    host: TARGET_HOST,
    origin: TARGET_ORIGIN,
    referer: refererHeader,
    'user-agent':
      (req.headers['user-agent'] as string) ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };

  // Strip hop-by-hop headers
  delete forwardHeaders['connection'];
  delete forwardHeaders['keep-alive'];
  delete forwardHeaders['transfer-encoding'];
  delete forwardHeaders['x-matched-path'];

  // Check if this request is a video stream, manifest, DRM OTP, or media segment
  // These MUST bypass any string buffering/transformation for instantaneous playback
  const isDirectMedia =
    targetPath.startsWith('/api/play') ||
    targetPath.startsWith('/api/get-otp') ||
    targetPath.startsWith('/api/video-url') ||
    targetPath.startsWith('/api/Schedule') ||
    targetPath.includes('.mpd') ||
    targetPath.includes('.m3u8') ||
    targetPath.includes('.m4s') ||
    targetPath.includes('.mp4');

  const proxyReq = https.request(
    targetUrl,
    {
      method: req.method,
      headers: forwardHeaders,
    },
    (proxyRes) => {
      const statusCode = proxyRes.statusCode || 200;
      const headers = { ...proxyRes.headers };

      // Remove framing/CSP restrictions to allow embedding in preview
      delete headers['x-frame-options'];
      delete headers['content-security-policy'];
      delete headers['content-security-policy-report-only'];

      // Allow CORS from any origin for media & API requests
      headers['access-control-allow-origin'] = '*';
      headers['access-control-allow-methods'] = 'GET, POST, OPTIONS, HEAD';
      headers['access-control-allow-headers'] = '*';

      // Rewrite cookies to work without strict domain pinning
      if (headers['set-cookie']) {
        const cookies = Array.isArray(headers['set-cookie'])
          ? headers['set-cookie']
          : [headers['set-cookie']];
        headers['set-cookie'] = cookies.map((c) =>
          c.replace(/domain=[^;]+;?/gi, '').replace(/Secure;?/gi, '')
        );
      }

      // Rewrite redirect Location to relative
      if (headers['location']) {
        headers['location'] = headers['location'].replace(
          /https?:\/\/(www\.)?learnxpw\.site/gi,
          ''
        );
      }

      const contentType = (headers['content-type'] || '').toLowerCase();

      // Only transform UI text (HTML, RSC components, search/batch listings, static scripts)
      // Never transform video streams, manifests, or media chunks!
      const isText =
        !isDirectMedia &&
        (contentType.includes('text/html') ||
          contentType.includes('application/x-javascript') ||
          contentType.includes('application/javascript') ||
          contentType.includes('text/javascript') ||
          contentType.includes('text/x-component') ||
          (contentType.includes('application/json') && !targetPath.startsWith('/api/play')));

      if (!isText) {
        // Stream binary responses and media segments directly at maximum wire speed
        res.writeHead(statusCode, headers);
        proxyRes.pipe(res);
        return;
      }

      // Buffer text responses for string substitution
      const chunks: Buffer[] = [];
      proxyRes.on('data', (chunk) => {
        chunks.push(chunk);
      });

      proxyRes.on('end', () => {
        try {
          const rawBuffer = Buffer.concat(chunks);
          let decompressedBuffer = rawBuffer;
          const encoding = (headers['content-encoding'] || '').toLowerCase();

          if (encoding === 'gzip') {
            decompressedBuffer = zlib.gunzipSync(rawBuffer);
          } else if (encoding === 'br') {
            decompressedBuffer = zlib.brotliDecompressSync(rawBuffer);
          } else if (encoding === 'deflate') {
            decompressedBuffer = zlib.inflateSync(rawBuffer);
          }

          const originalText = decompressedBuffer.toString('utf-8');
          const modifiedText = transformText(originalText);
          const outputBuffer = Buffer.from(modifiedText, 'utf-8');

          // Remove compression and chunking headers since output is uncompressed with exact length
          delete headers['content-encoding'];
          delete headers['transfer-encoding'];
          headers['content-length'] = String(outputBuffer.length);

          res.writeHead(statusCode, headers);
          res.end(outputBuffer);
        } catch (err) {
          console.error('Error modifying text response:', err);
          const rawBuffer = Buffer.concat(chunks);
          delete headers['transfer-encoding'];
          headers['content-length'] = String(rawBuffer.length);
          res.writeHead(statusCode, headers);
          res.end(rawBuffer);
        }
      });
    }
  );

  proxyReq.on('error', (err) => {
    console.error('Proxy request error:', err);
    if (!res.headersSent) {
      res.status(502).send(`Proxy Error: ${err.message}`);
    }
  });

  // Pipe request body if POST/PUT
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

// Catch-all route to proxy every path
app.use((req, res) => {
  handleProxy(req, res);
});

export default app;
