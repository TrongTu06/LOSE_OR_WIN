const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT_DIR = __dirname;
const INDEX_PATH = path.join(ROOT_DIR, 'index.html');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendResponse(res, status, contentType, body) {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

function sendNotFound(res) {
  sendResponse(res, 404, 'text/plain; charset=utf-8', '404 Not Found');
}

function serveIndexFallback(res) {
  fs.readFile(INDEX_PATH, (err, html) => {
    if (err) {
      sendNotFound(res);
      return;
    }
    sendResponse(res, 200, MIME_TYPES['.html'], html);
  });
}

function handleRequest(req, res) {
  const requestPath = decodeURI(req.url.split('?')[0]) || '/';
  const resolvedPath = requestPath === '/'
    ? INDEX_PATH
    : path.join(ROOT_DIR, requestPath);
  const extension = path.extname(resolvedPath).toLowerCase();

  fs.readFile(resolvedPath, (err, content) => {
    if (err) {
      if (err.code !== 'ENOENT') {
        sendResponse(res, 500, 'text/plain; charset=utf-8', '500 Server Error');
        return;
      }

      if (!extension || extension === '.html') {
        serveIndexFallback(res);
        return;
      }

      sendNotFound(res);
      return;
    }

    const contentType = MIME_TYPES[extension] || 'application/octet-stream';
    sendResponse(res, 200, contentType, content);
  });
}

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
