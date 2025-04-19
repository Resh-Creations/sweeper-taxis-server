const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });
const clients = new Map();
const taxiGroups = new Map(); // Map groupId to array of {id, lat, lng, ws}
let groupCounter = 1;

console.log("Server starting...");

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function assignTaxiToGroup(clientId, lat, lng, ws, userType) {
    if (userType !== 'taxi') {
        clients.set(clientId, { ws, lat, lng, userType });
        return null;
    }

    for (const [groupId, members] of taxiGroups) {
        if (members.length < 3) {
            const leader = members[0];
            const distance = getDistance(leader.lat, leader.lng, lat, lng);
            if (distance <= 1.3) {
                members.push({ id: clientId, lat, lng, ws });
                clients.set(clientId, { ws, lat, lng, userType, groupId });
                console.log(`Client ${clientId} joined group ${groupId}`);
                return groupId;
            }
        }
    }

    if (taxiGroups.size < 100) {
        const newGroupId = `group_${groupCounter++}`;
        taxiGroups.set(newGroupId, [{ id: clientId, lat, lng, ws }]);
        clients.set(clientId, { ws, lat, lng, userType, groupId: newGroupId });
        console.log(`Client ${clientId} created new group ${newGroupId}`);
        return newGroupId;
    }

    return null;
}

wss.on('connection', (ws) => {
    console.log('New client connected');
    let clientId = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'register') {
                clientId = data.id;
                if (!
