import WebSocket from 'ws';

console.log('Testing WebSocket connection to ws://localhost:8080...');

const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
  console.log('✅ WebSocket connection opened successfully!');
  ws.close();
});

ws.on('error', (err) => {
  console.error('❌ WebSocket connection error:', err.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('WebSocket connection closed');
  process.exit(0);
});

setTimeout(() => {
  console.error('❌ Connection timeout after 5 seconds');
  ws.close();
  process.exit(1);
}, 5000);
