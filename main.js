const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const url = require('url');

const APP_DIR = path.join(__dirname, 'app');
const ENTRY = 'Shot Calculator.dc.html';

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

// Serving the app over localhost (instead of file://) so that module imports,
// fetch, and blob URLs all work under a normal http origin.
function startServer(callback) {
  const server = http.createServer((req, res) => {
    let pathname = decodeURIComponent(url.parse(req.url).pathname);
    if (pathname === '/' || pathname === '') pathname = '/' + ENTRY;

    const filePath = path.join(APP_DIR, path.normalize(pathname));
    if (!filePath.startsWith(APP_DIR)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
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
  win.loadURL('http://127.0.0.1:' + port + '/' + encodeURIComponent(ENTRY));
}

app.whenReady().then(() => startServer(createWindow));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
