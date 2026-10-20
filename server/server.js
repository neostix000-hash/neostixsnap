import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequestHandler } from './src/app.js';
import { assertSafeBinding, loadEnvFile, readConfig } from './src/config.js';

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href ===
    pathToFileURL(fileURLToPath(import.meta.url)).href;

export function startServer({ config, logger = console } = {}) {
  const handler = createRequestHandler({ config, logger });
  const server = http.createServer(handler);
  server.requestTimeout = config.requestTimeoutMs + 5000;
  server.headersTimeout = 20000;
  server.keepAliveTimeout = 5000;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

if (isMain) {
  loadEnvFile();
  let config;
  try {
    config = readConfig();
    assertSafeBinding(config);
  } catch (error) {
    console.error(`\n[NeostixSnap] Configuration error:\n${error.message}\n`);
    process.exit(1);
  }

  console.log('');
  console.log(`  NeostixSnap backend v${config.serverVersion}`);
  console.log(`  Listening: http://${config.host}:${config.port}`);
  console.log(`  Provider:  ${config.provider} / ${config.model}`);
  console.log(`  Auth:      ${config.extensionToken ? 'extension token required' : 'disabled (local mode)'}`);
  if (!config.ready) {
    console.log('  AI status: NOT CONFIGURED');
    for (const problem of config.problems) console.log(`    - ${problem}`);
  } else {
    console.log('  AI status: configured');
  }
  if (!config.extensionToken) {
    console.log('  Tip: set EXTENSION_TOKEN for a shared secret, even locally.');
  }
  console.log('');

  const handler = createRequestHandler({ config });
  const server = http.createServer(handler);
  server.requestTimeout = config.requestTimeoutMs + 5000;
  server.headersTimeout = 20000;
  server.keepAliveTimeout = 5000;

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `[NeostixSnap] Port ${config.port} is already in use. Stop the other process or set PORT.`
      );
    } else {
      console.error('[NeostixSnap] Server error:', error.message);
    }
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    console.log('[NeostixSnap] Ready. Press Ctrl+C to stop.');
  });

  const shutdown = (signal) => {
    console.log(`\n[NeostixSnap] ${signal} received, shutting down...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
