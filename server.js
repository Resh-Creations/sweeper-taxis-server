const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://sjdybxohklsdtplemfvh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqZHlieG9oa2xzZHRwbGVtZnZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQxMDM0ODcsImV4cCI6MjA1OTY3OTQ4N30.0vNMTYhQV6TsqDhypw1RSJTROPST8nVa9cP6fWMF9bg';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });
const clients = new Map(); // Maps client WebSocket to { id, type, lat, lng, group_id }

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function joinTaxiGroup(userId, lat, lng, type, ws) {
    if (type !== 'taxi') {
        return { success: true, group_id: null }; // Commuters don't join groups
    }

    const distanceThreshold = 1.3; // 1.3 meters
    const latDelta = distanceThreshold / 111000; // Approx 1.3m in degrees

    try {
        const { data: groups, error } = await supabase
            .from('taxi_groups')
            .select('*')
            .gte('lat', lat - latDelta)
            .lte('lat', lat + latDelta)
            .gte('lng', lng - latDelta)
            .lte('lng', lng + latDelta);

        if (error) {
            console.error('Error fetching groups:', error);
            ws.send(JSON.stringify({ error: 'Group check failed' }));
            return { success: false };
        }

        const group = groups.find(g => g.user_count < 3);
        if (group) {
            const { error } = await supabase
                .from('taxi_groups')
                .update({
                    user_ids: [...group.user_ids, userId],
                    user_count: group.user_count + 1
                })
                .eq('group_id', group.group_id);

            if (error) {
                console.error('Error updating group:', error);
                ws.send(JSON.stringify({ error: 'Failed to join group' }));
                return { success: false };
            }
            console.log(`User ${userId} joined group ${group.group_id}`);
            return { success: true, group_id: group.group_id };
        } else {
            const newGroupId = Math.random().toString(36).substring(2);
            const { error } = await supabase
                .from('taxi_groups')
                .insert({
                    group_id: newGroupId,
                    lat,
                    lng,
                    user_count: 1,
                    user_ids: [userId]
                });

            if (error) {
                console.error('Error creating group:', error);
                ws.send(JSON.stringify({ error: 'Failed to create group' }));
                return { success: false };
            }
            console.log(`User ${userId} created group ${newGroupId}`);
            return { success: true, group_id: newGroupId };
        }
    } catch (e) {
        console.error('Error in joinTaxiGroup:', e);
        ws.send(JSON.stringify({ error: 'Server error' }));
        return { success: false };
    }
}

async function removeFromGroup(userId, groupId) {
    if (!groupId) return;
    try {
        const { data: group, error } = await supabase
            .from('taxi_groups')
            .select('*')
            .eq('group_id', groupId)
            .single();

        if (error || !group) {
            console.error('Error fetching group for removal:', error);
            return;
        }

        const updatedUserIds = group.user_ids.filter(id => id !== userId);
        if (updatedUserIds.length === 0) {
            const { error } = await supabase
                .from('taxi_groups')
                .delete()
                .eq('group_id', groupId);
            if (error) {
                console.error('Error deleting group:', error);
            } else {
                console.log(`Deleted empty group ${groupId}`);
            }
        } else {
            const { error } = await supabase
                .from('taxi_groups')
                .update({
                    user_ids: updatedUserIds,
                    user_count: updatedUserIds.length
                })
                .eq('group_id', groupId);
            if (error) {
                console.error('Error updating group:', error);
            } else {
                console.log(`Removed user ${userId} from group ${groupId}`);
            }
        }
    } catch (e) {
        console.error('Error in removeFromGroup:', e);
    }
}

wss.on('connection', ws => {
    console.log('New client connected');
    let clientId, clientType, groupId;

    ws.on('message', async data => {
        try {
            const message = JSON.parse(data);
            if (!message.id || !message.type || !message.lat || !message.lng) {
                console.error('Invalid message:', message);
                ws.send(JSON.stringify({ error: 'Invalid message' }));
                return;
            }

            clientId = message.id;
            clientType = message.type;
            const lat = message.lat;
            const lng = message.lng;

            if (!clients.has(ws)) {
                const joinResult = await joinTaxiGroup(clientId, lat, lng, clientType, ws);
                if (!joinResult.success) {
                    ws.close();
                    return;
                }
                groupId = joinResult.group_id;
                clients.set(ws, { id: clientId, type: clientType, lat, lng, group_id: groupId });
                console.log(`Client registered: ID=${clientId}, Type=${clientType}, Group=${groupId || 'none'}`);
            } else {
                clients.set(ws, { id: clientId, type: clientType, lat, lng, group_id: groupId });
            }

            // Broadcast to all clients within 750m
            const broadcastData = JSON.stringify({ id: clientId, type: clientType, lat, lng });
            clients.forEach((client, clientWs) => {
                if (clientWs.readyState === WebSocket.OPEN) {
                    const distance = getDistance(lat, lng, client.lat, client.lng);
                    if (distance <= 750) {
                        clientWs.send(broadcastData);
                    }
                }
            });
        } catch (e) {
            console.error('Error processing message:', e);
            ws.send(JSON.stringify({ error: 'Invalid message format' }));
        }
    });

    ws.on('close', async () => {
        console.log(`Client disconnected: ID=${clientId}`);
        if (clientId && groupId) {
            await removeFromGroup(clientId, groupId);
        }
        clients.delete(ws);
    });

    ws.on('error', err => {
        console.error('WebSocket error:', err);
    });
});

console.log('WebSocket server running on port', process.env.PORT || 8080);
