const WebSocket = require('ws');

// Connect to your server
const ws = new WebSocket('ws://localhost:8080/test-document');

ws.on('open', () => {
  console.log('✅ Connected to server');
  
  // You should receive sync messages automatically
  setTimeout(() => {
    console.log('Closing connection...');
    ws.close();
  }, 3000);
});

ws.on('message', (data) => {
  console.log('📨 Received message:', data.length, 'bytes');
  console.log('   Data:', Array.from(data).join(','));
});

ws.on('close', (code, reason) => {
  console.log('🔌 Connection closed:', code, reason.toString());
});

ws.on('error', (error) => {
  console.log('❌ Error:', error.message);
});