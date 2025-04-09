const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

const MAX_USERS = 700;
let connectedClients = new Map();

wss.on('connection', (ws) => {
    console.log('New client connected');

    if (connectedClients.size >= MAX_USERS) {
        ws.send(JSON.stringify({ error: 'Server at capacity' }));
        ws.close();
        return;
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (!data.id || !data.lat || !data.lng || !data.type) return;

            connectedClients.set(ws, data.id);

            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        id: data.id,
                        lat: data.lat,
                        lng: data.lng,
                        type: data.type,
                        licensePlate: data.licensePlate || null
                    }));
                }
            });
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });

    ws.on('close', () => {
        connectedClients.delete(ws);
        console.log('Client disconnected');
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
        connectedClients.delete(ws);
    });
});

console.log(`WebSocket server running on port ${process.env.PORT || 8080}`);
