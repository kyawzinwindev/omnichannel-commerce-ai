const net = require('net');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '../..');
const PORTS = [
  { name: 'PostgreSQL', port: 5433 },
  { name: 'Redis', port: 6379 },
];

function checkPort(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function areAllPortsOpen() {
  const results = await Promise.all(PORTS.map((p) => checkPort(p.port)));
  return results.every(Boolean);
}

async function main() {
  if (await areAllPortsOpen()) {
    return;
  }

  console.log('[infra] PostgreSQL (5433) or Redis (6379) is not reachable on 127.0.0.1. Recreating Docker containers...');
  try {
    execSync('docker compose up -d --force-recreate', {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
  } catch (err) {
    console.warn(`[infra] Could not auto-start Docker containers (${err.message}). Continuing startup...`);
    return;
  }

  for (let attempt = 1; attempt <= 20; attempt++) {
    if (await areAllPortsOpen()) {
      console.log('[infra] PostgreSQL (5433) and Redis (6379) are online.');
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.warn('[infra] Timed out waiting for ports 5433/6379 to open.');
}

main();
