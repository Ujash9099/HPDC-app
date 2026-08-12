// Derives a stable, hardware-based Machine ID and exposes it to the app.
// Runs in Electron's preload context: has Node access, but the page itself
// stays sandboxed (contextIsolation stays on).

const { contextBridge } = require('electron');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

// Alphabet excludes 0/O/1/I so IDs are safe to read aloud and retype.
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function formatId(hashHex) {
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += ALPHA[parseInt(hashHex.substr(i * 2, 2), 16) % ALPHA.length];
  }
  return out.slice(0, 4) + '-' + out.slice(4, 8) + '-' + out.slice(8, 12);
}

// Windows: MachineGuid is written at OS install time and survives app
// reinstalls, app-data wipes and user changes. This is the strongest anchor.
function windowsMachineGuid() {
  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString();
    const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

// macOS: the hardware UUID from the platform expert device.
function macPlatformUuid() {
  try {
    const out = execSync(
      'ioreg -rd1 -c IOPlatformExpertDevice',
      { stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString();
    const m = out.match(/IOPlatformUUID"?\s*=\s*"([^"]+)"/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

// Linux: the systemd/dbus machine id.
function linuxMachineId() {
  try {
    const fs = require('fs');
    for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      if (fs.existsSync(p)) {
        const v = fs.readFileSync(p, 'utf8').trim();
        if (v) return v;
      }
    }
  } catch (e) {}
  return null;
}

// Last resort: first physical MAC address + hostname + CPU model.
function fallbackFingerprint() {
  let mac = '';
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces).sort()) {
    for (const i of ifaces[name] || []) {
      if (!i.internal && i.mac && i.mac !== '00:00:00:00:00:00') { mac = i.mac; break; }
    }
    if (mac) break;
  }
  const cpu = (os.cpus()[0] || {}).model || '';
  return [mac, os.hostname(), cpu, os.arch()].join('|');
}

function machineId() {
  const anchor =
    (process.platform === 'win32'  ? windowsMachineGuid() : null) ||
    (process.platform === 'darwin' ? macPlatformUuid()    : null) ||
    (process.platform === 'linux'  ? linuxMachineId()     : null) ||
    fallbackFingerprint();

  // Hashed with a product salt so the raw OS identifier never leaves the machine.
  const hash = crypto.createHash('sha256')
    .update('HPDC-MACHINE-v1|' + anchor)
    .digest('hex');

  return formatId(hash);
}

contextBridge.exposeInMainWorld('hpdcNative', {
  machineId: machineId(),
  platform: process.platform
});
