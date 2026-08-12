// Downloads the runtime's CDN dependencies into renderer/vendor/ and rewrites
// support.js to load them locally, so the packaged app needs no internet.
// Runs automatically before `npm run build` (see package.json "prebuild").

const fs = require('fs');
const path = require('path');
const https = require('https');

const RENDERER = path.join(__dirname, 'renderer');
const VENDOR = path.join(RENDERER, 'vendor');

const DEPS = [
  { url: 'https://unpkg.com/react@18.3.1/umd/react.production.min.js',          file: 'react.production.min.js' },
  { url: 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',  file: 'react-dom.production.min.js' },
  { url: 'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js',             file: 'babel.min.js' }
];

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects for ' + url));
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return download(next, dest, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(VENDOR, { recursive: true });

  for (const dep of DEPS) {
    const dest = path.join(VENDOR, dep.file);
    process.stdout.write('vendoring ' + dep.file + ' ... ');
    await download(dep.url, dest);
    console.log(fs.statSync(dest).size + ' bytes');
  }

  const supportPath = path.join(RENDERER, 'support.js');
  let src = fs.readFileSync(supportPath, 'utf8');
  let changes = 0;

  for (const dep of DEPS) {
    if (src.includes(dep.url)) {
      src = src.split(dep.url).join('./vendor/' + dep.file);
      changes++;
    }
  }

  // Integrity hashes are for the CDN responses; drop them for local files.
  src = src.replace(/(var (?:REACT|REACT_DOM|BABEL)_SRI\s*=\s*)"[^"]*"/g, '$1""');

  fs.writeFileSync(supportPath, src);
  console.log('patched support.js (' + changes + ' CDN url(s) redirected to local copies)');

  const html = path.join(RENDERER, 'index.html');
  let page = fs.readFileSync(html, 'utf8');
  const three = 'https://unpkg.com/three@0.128.0/build/three.min.js';
  if (page.includes(three)) {
    const dest = path.join(VENDOR, 'three.min.js');
    process.stdout.write('vendoring three.min.js ... ');
    await download(three, dest);
    console.log(fs.statSync(dest).size + ' bytes');
    page = page.split(three).join('./vendor/three.min.js');
    fs.writeFileSync(html, page);
    console.log('patched index.html (three.js now local)');
  }
})().catch((e) => {
  console.error('\nvendor step failed:', e.message);
  process.exit(1);
});
