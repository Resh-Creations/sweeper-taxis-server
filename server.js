const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });
const clients = new Map();
const taxiGroups = new Map();
let groupCounter = 1;

console.log("Server starting...");

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
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
                console.log(`Client ${clientId} joined group ${groupId} (${members.length}/3 members)`);
                return groupId;
            }
        }
    }

    if (taxiGroups.size < 100) {
        const newGroupId = `group_${groupCounter++}`;
        taxiGroups.set(newGroupId, [{ id: clientId, lat, lng, ws }]);
        clients.set(clientId, { ws, lat, lng, userType, groupId: newGroupId });
        console.log(`Client ${clientId} created new group ${newGroupId} (1/3 members)`);
        return newGroupId;
    }

    console.log(`Client ${clientId} rejected: No available groups (max 100 groups reached)`);
    ws.send(JSON.stringify({ type: 'groupAssignment', id: clientId, error: 'taxi_limit', message: 'No available taxi groups' }));
    ws.close(1000, 'No available taxi groups');
    return null;
}

wss.on('connection', (ws) => {
    console.log('New client connected');
    let clientId = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (!data.type || !data.id) {
                console.log(`Invalid message received: ${message}`);
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
                return;
            }

            if (data.type === 'register') {
                clientId = data.id;
                if (!clientId || !['taxi', 'commuter'].includes(data.userType)) {
                    console.log(`Invalid registration: ID=${clientId}, Type=${data.userType}`);
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid registration' }));
                    ws.close(1000, 'Invalid registration');
                    return;
                }
                console.log(`Client ${clientId} registered as ${data.userType}`);
                const lat = data.lat || 0;
                const lng = data.lng || 0;

                if (data.userType === 'taxi') {
                    const groupId = assignTaxiToGroup(clientId, lat, lng, ws, data.userType);
                    if (groupId) {
                        ws.send(JSON.stringify({ type: 'groupAssignment', id: clientId, taxiGroupId: groupId }));
                    } else {
                        ws.send(JSON.stringify({ type: 'groupAssignment', id: clientId, error: 'taxi_limit', message: 'Only 3 taxi users allowed per taxi' }));
                        ws.close(1000, 'Taxi user limit reached');
                        return;
                    }
                } else {
                    clients.set(clientId, { ws, lat, lng, userType: data.userType });
                }
            } else if (data.id && data.lat && data.lng && data.type) {
                if (clients.has(data.id)) {
                    const client = clients.get(data.id);
                    client.lat = data.lat;
                    client.lng = data.lng;
                    client.userType = data.type;
                    if (data.taxiGroupId && client.groupId === data.taxiGroupId) {
                        const group = taxiGroups.get(data.taxiGroupId);
                        if (group) {
                            const member = group.find(m => m.id === data.id);
                            if (member) {
                                member.lat = data.lat;
                                member.lng = data.lng;
                            }
                        }
                    }
                    clients.set(data.id, client);
                    clients.forEach((c, id) => {
                        if (id !== data.id && c.ws.readyState === WebSocket.OPEN) {
                            c.ws.send(JSON.stringify(data));
                        }
                    });
                    console.log(`Broadcasted location for ${data.id} (${data.type}) at ${data.lat}, ${data.lng}`);
                }
            } else {
                console.log(`Unknown message type: ${data.type}`);
                ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
            }
        } catch (e) {
            console.error(`Error processing message: ${e.message}, Raw: ${message}`);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        }
    });

    ws.on('close', (code, reason) => {
        if (clientId) {
            console.log(`Client ${clientId} disconnected. Code: ${code}, Reason: ${reason}`);
            clients.delete(clientId);
            for (const [groupId, members] of taxiGroups) {
                const index = members.findIndex(m => m.id === clientId);
                if (index !== -1) {
                    members.splice(index, 1);
                    console.log(`Removed ${clientId} from group ${groupId} (${members.length}/3 members)`);
                    if (members.length === 0) {
                        taxiGroups.delete(groupId);
                        console.log(`Deleted empty group ${groupId}`);
                    }
                }
            }
        } else {
            console.log(`Unknown client disconnected. Code: ${code}, Reason: ${reason}`);
        }
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error: ${error.message}`);
        if (clientId) {
            clients.delete(clientId);
            for (const [groupId, members] of taxiGroups) {
                const index = members.findIndex(m => m.id === clientId);
                if (index !== -1) {
                    members.splice(index, 1);
                    if (members.length === 0) {
                        taxiGroups.delete(groupId);
                    }
                }
            }
        }
    });
});

console.log(`WebSocket server running on port ${process.env.PORT || 8080}`);
