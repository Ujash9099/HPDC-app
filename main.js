const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const url = require('url');

const ROOT = path.join(__dirname, 'renderer');
const ENTRY = 'index.html';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2':'font/woff2'
};

// The app is served over localhost rather than file:// so that ES module
// imports, fetch, and blob URLs all work under a normal http origin.
function startServer(callback) {
  const server = http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(url.parse(req.url).pathname); }
    catch (e) { pathname = url.parse(req.url).pathname; }

    if (!pathname || pathname === '/') pathname = '/' + ENTRY;

    const rel = path.normalize(pathname).replace(/^[\\/]+/, '');
    const filePath = path.join(ROOT, rel);

    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found: ' + rel + '\nLooked in: ' + ROOT);
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });

  server.on('error', (e) => {
    dialog.showErrorBox('Server error', String(e && e.message || e));
  });

  server.listen(0, '127.0.0.1', () => callback(server.address().port));
}

function createWindow(port) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });

  Menu.setApplicationMenu(null);
  win.loadURL('http://127.0.0.1:' + port + '/');
}

app.whenReady().then(() => {
  if (!fs.existsSync(path.join(ROOT, ENTRY))) {
    dialog.showErrorBox(
      'Missing application files',
      'Could not find:\n' + path.join(ROOT, ENTRY) +
      '\n\nThe renderer folder was not included in the build.'
    );
    app.quit();
    return;
  }
  startServer(createWindow);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
