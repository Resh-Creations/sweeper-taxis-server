const WebSocket = require('ws');
const server = new WebSocket.Server({ port: process.env.PORT || 8080 });

const clients = new Map(); // Store client connections with their deviceId
const MAX_CLIENTS = 700; // Cap the number of clients to 700

server.on('connection', (ws) => {
    console.log('New client connected');

    // Handle incoming messages
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const { lat, lng, type, id } = data;

            // Validate message
            if (!lat || !lng || !type || !id) {
                console.log('Invalid message received:', data);
                return;
            }

            // Store or update client data
            clients.set(id, { ws, lat, lng, type });

            // Broadcast to all other clients within 750m
            const broadcastData = JSON.stringify({ lat, lng, type, id });
            clients.forEach((client, clientId) => {
                if (clientId !== id && client.ws.readyState === WebSocket.OPEN) {
                    const distance = getDistance(lat, lng, client.lat, client.lng);
                    if (distance <= 750) {
                        client.ws.send(broadcastData);
                    }
                }
            });
        } catch (e) {
            console.error('Error processing message:', e.message);
        }
    });

    ws.on('close', () => {
        // Remove client from the map
        for (const [id, client] of clients.entries()) {
            if (client.ws === ws) {
                clients.delete(id);
                console.log(`Client ${id} disconnected`);
                break;
            }
        }
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
    });

    // Reject new connections if the server is at capacity
    if (clients.size >= MAX_CLIENTS) {
        ws.close(1000, 'Server at capacity');
        console.log('Rejected new connection: Server at capacity');
    }
});

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

console.log('WebSocket server running on port', process.env.PORT || 8080);
