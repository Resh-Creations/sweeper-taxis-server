const WebSocket = require('ws');
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('New user connected. Total:', clients.size);

    ws.on('message', (message) => {
        console.log('Received:', message);
        clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log('User disconnected. Total:', clients.size);
    });
});

console.log(`Server running on port ${port}`);
