const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Map(); // Store client connections with their deviceId
const MAX_CLIENTS = 700; // Cap the number of clients to 700
const PING_INTERVAL = 10000; // Ping every 10 seconds
const TIMEOUT = 30000; // Timeout after 30 seconds of inactivity

// Serve static files (e.g., map.html) from 'public' folder
app.use(express.static('public'));

wss.on('connection', (ws) => {
    // Reject if server is at capacity
    if (clients.size >= MAX_CLIENTS) {
        ws.close(1000, 'Server at capacity');
        console.log('Rejected new connection: Server at capacity');
        return;
    }

    console.log('New client connected');

    // Initialize client data
    ws.isAlive = true;
    let clientId = null;

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
            if (!clientId) {
                clientId = id;
                clients.set(id, { ws, lat, lng, type, lastPong: Date.now() });
                console.log(`Client registered: ${clientId}`);
            } else {
                clients.set(id, { ws, lat, lng, type, lastPong: Date.now() });
            }

            // Broadcast to all other clients within 750m
            const broadcastData = JSON.stringify({ lat, lng, type, id });
            clients.forEach((client, otherId) => {
                if (otherId !== id && client.ws.readyState === WebSocket.OPEN) {
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

    // Handle pong responses
    ws.on('pong', () => {
        if (clientId) {
            const clientData = clients.get(clientId);
            if (clientData) {
                clientData.lastPong = Date.now();
                ws.isAlive = true;
            }
        }
    });

    // Handle client disconnection
    ws.on('close', (code, reason) => {
        if (clientId) {
            clients.delete(clientId);
            console.log(`Client ${clientId} disconnected. Code: ${code}, Reason: ${reason}`);
        } else {
            console.log('Unknown client disconnected');
        }
    });

    // Handle errors
    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
        ws.terminate();
        if (clientId) {
            clients.delete(clientId);
            console.log(`Client ${clientId} terminated due to error`);
        }
    });
});

// Ping clients to check if they are alive
setInterval(() => {
    const now = Date.now();
    wss.clients.forEach((ws) => {
        const clientData = clients.get([...clients.entries()].find(([_, data]) => data.ws === ws)?.[0]);
        if (!clientData) return;
        if (now - clientData.lastPong > TIMEOUT) {
            console.log(`Terminating inactive client: ${clientData.id}`);
            ws.terminate();
            clients.delete(clientData.id);
            return;
        }
        if (ws.isAlive === false) {
            console.log(`No pong received, terminating client: ${clientData.id}`);
            ws.terminate();
            clients.delete(clientData.id);
            return;
        }
        ws.isAlive = false;
        ws.ping();
    });
}, PING_INTERVAL);

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`WebSocket server running on port ${PORT}`);
});
