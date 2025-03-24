const WebSocket = require('ws');
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });
wss.on('connection', (ws) => {
    console.log('New user connected');
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message); // Expecting { lat, lng, type }
            console.log('Received:', data);
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });
    ws.on('close', () => {
        console.log('User disconnected');
    });
});
console.log(`WebSocket server running on port ${port}`);
