import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startDaemon } from '../src/runtime/agent-daemon.js';

test('CORS includes bound port in allowed origin', async () => {
  const server = await startDaemon({ host: '127.0.0.1', port: 0 });
  const actualPort = server.url.match(/:(\d+)/)[1];
  
  try {
    const response = await fetch(`${server.url}/health`);
    const corsOrigin = response.headers.get('access-control-allow-origin');
    
    assert.ok(corsOrigin, 'CORS header should be present');
    assert.ok(corsOrigin.includes(actualPort), `CORS origin should include port ${actualPort}, got ${corsOrigin}`);
    assert.equal(corsOrigin, `http://127.0.0.1:${actualPort}`);
  } finally {
    await server.close();
  }
});

test('CORS header is set on error responses', async () => {
  const server = await startDaemon({ host: '127.0.0.1', port: 0 });
  const actualPort = server.url.match(/:(\d+)/)[1];
  
  try {
    const response = await fetch(`${server.url}/nonexistent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invalid: 'call' })
    });
    
    const corsOrigin = response.headers.get('access-control-allow-origin');
    assert.ok(corsOrigin, 'CORS header should be present on error responses');
    assert.equal(corsOrigin, `http://127.0.0.1:${actualPort}`);
  } finally {
    await server.close();
  }
});

test('multiple daemon instances on different ports have correct CORS', async () => {
  const server1 = await startDaemon({ host: '127.0.0.1', port: 0 });
  const server2 = await startDaemon({ host: '127.0.0.1', port: 0 });
  
  const port1 = server1.url.match(/:(\d+)/)[1];
  const port2 = server2.url.match(/:(\d+)/)[1];
  
  assert.notEqual(port1, port2, 'Servers should bind to different ports');
  
  try {
    const response1 = await fetch(`${server1.url}/health`);
    const cors1 = response1.headers.get('access-control-allow-origin');
    assert.equal(cors1, `http://127.0.0.1:${port1}`);
    
    const response2 = await fetch(`${server2.url}/health`);
    const cors2 = response2.headers.get('access-control-allow-origin');
    assert.equal(cors2, `http://127.0.0.1:${port2}`);
  } finally {
    await server1.close();
    await server2.close();
  }
});

test('daemon binds to default port when specified', async () => {
  const { DEFAULT_DAEMON_PORT } = await import('../src/shared/constants.js');
  
  let server;
  try {
    server = await startDaemon({ host: '127.0.0.1', port: DEFAULT_DAEMON_PORT });
    const actualPort = server.url.match(/:(\d+)/)[1];
    assert.equal(actualPort, String(DEFAULT_DAEMON_PORT));
    
    const response = await fetch(`${server.url}/health`);
    const corsOrigin = response.headers.get('access-control-allow-origin');
    assert.equal(corsOrigin, `http://127.0.0.1:${DEFAULT_DAEMON_PORT}`);
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      console.log(`Port ${DEFAULT_DAEMON_PORT} is already in use, skipping this test`);
      return;
    }
    throw error;
  } finally {
    if (server) await server.close();
  }
});
