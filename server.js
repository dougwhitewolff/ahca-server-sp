// server.js
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy headers so req.protocol reflects x-forwarded-proto (important for Twilio signature validation behind ngrok/proxies)
app.set('trust proxy', true);

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket servers (noServer for explicit routing)
const wss = new WebSocket.Server({ noServer: true });
// Twilio WS: explicit upgrade handling
const wssTwilio = new WebSocket.Server({
  noServer: true,
  perMessageDeflate: false,
  handleProtocols: (protocols, request) => {
    // Echo back a subprotocol Twilio offers (required for handshake)
    try {
      // ws passes a Set of protocols per docs
      if (protocols && typeof protocols[Symbol.iterator] === 'function') {
        let first = null;
        for (const p of protocols) {
          if (!first) first = p;
          if (p === 'audio.stream.twilio.com') return p;
        }
        return first || undefined;
      }
      if (Array.isArray(protocols) && protocols.length > 0) {
        return protocols.includes('audio.stream.twilio.com') ? 'audio.stream.twilio.com' : protocols[0];
      }
      if (typeof protocols === 'string' && protocols.length > 0) {
        const parts = protocols.split(',').map(s => s.trim());
        return parts.includes('audio.stream.twilio.com') ? 'audio.stream.twilio.com' : parts[0];
      }
      return undefined;
    } catch (e) {
      return undefined;
    }
  }
});

// Middleware
const corsOptions = {
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' })); // Increase limit for audio data
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Routes
app.use('/api/knowledge', require('./features/voice-agent/routes/knowledge'));
app.use('/api/voice-tools', require('./features/voice-agent/routes/voice-tools'));
// Legacy chained-voice route removed - using Realtime API now
app.use('/api/estimate', require('./features/estimator/routes/estimate'));
app.use('/twilio', require('./features/voice-agent/routes/twilio-voice'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'After Hours Call Server is running' });
});

// Initialize WebSocket handlers
const { setupRealtimeWebSocket } = require('./features/voice-agent/routes/realtime-websocket');
const { setupTwilioMediaWebSocket } = require('./features/voice-agent/routes/twilio-media');
setupRealtimeWebSocket(wss);
setupTwilioMediaWebSocket(wssTwilio);

// Explicit HTTP upgrade routing for WebSockets
server.on('upgrade', (req, socket, head) => {
  console.log('🔼 [HTTP Upgrade] url:', req.url, 'upgrade:', req.headers['upgrade'], 'protocols:', req.headers['sec-websocket-protocol']);
  try {
    const url = req.url || '';
    if (url.startsWith('/twilio-media')) {
      console.log('🔁 [HTTP Upgrade] Routing to Twilio WS');
      wssTwilio.handleUpgrade(req, socket, head, (ws) => {
        wssTwilio.emit('connection', ws, req);
      });
      return;
    }
    if (url.startsWith('/realtime-ws')) {
      console.log('🔁 [HTTP Upgrade] Routing to Realtime WS');
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
      return;
    } else {
      // Let other upgrades (like /realtime-ws) be handled by their own server
      // Unknown path
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
  } catch (e) {
    try { socket.destroy(); } catch (_) {}
  }
});

server.listen(PORT, () => {
  console.log(`AHCA Server running on port ${PORT}`);
  console.log(`WebSocket server ready at ws://localhost:${PORT}/realtime-ws`);
  console.log(`Twilio Media WS ready at ws://localhost:${PORT}/twilio-media`);
});
