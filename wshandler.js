// wsHandler.js
const { rooms, createRoom, getRoom, deleteRoom } = require('./room.js');
const { v4: uuidv4 } = require('uuid');
//loses data if i close this program not server
const socketMap = {};


function setupWebSocket(server) {
    const WebSocket = require('ws');
    const wss = new WebSocket.Server({ server });
    //Maintains socketMap to track which socket belongs to which user and room.
    // socketId -> { roomId, userId }

    wss.on('connection', (ws) => {
        ws.id = uuidv4(); // unique socket ID
        console.log("🔌 New socket connected:", ws.id);
        //const socketMap = {};  dont place as server restsart it starts and loses its data

        ws.on('message', (message) => {
            let data;
            try {
                data = JSON.parse(message);
            }
            catch {
                return;
            }

            const { type, payload } = data;
            //! 1.main user creates room and he gets added to the session

            if (type === 'CREATE_ROOM') {
                const { name } = payload;
                const userId = uuidv4();
                const roomId = createRoom(userId); // creator ID passed to room

                const room = getRoom(roomId);
                room.users[userId] = {
                    socketId: ws.id,
                    name,
                    location: null,
                    lastUpdated: null,
                };

                socketMap[ws.id] = { roomId, userId };

                // Respond with both room + user details
                ws.send(JSON.stringify({
                    type: 'ROOM_CREATED',
                    payload: {
                        roomId,
                        userId,
                        users: room.users,
                    }
                }));

                broadcastRoom(roomId,"CREATED_ROOM");
            }
            //! 2.
            if (type === 'JOIN_ROOM') {
                const { roomId, name } = payload;
                const roomdetails = getRoom(roomId);
                if (!roomdetails)
                    return ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Room not found' } }));

                if (socketMap[ws.id]?.roomId === roomId) {
                    return ws.send(JSON.stringify({
                        type: 'ERROR',
                        payload: { message: 'You have already joined this room.' }
                    }));
                }

                const uid = uuidv4(); // joined users will be assigned new uerid 
                roomdetails.users[uid] = {
                    socketId: ws.id,
                    name,
                    location: null,
                    lastUpdated: null,
                };



                //saving websocket connections : with (roomid,userId)
                socketMap[ws.id] = { roomId, userId: uid };


                ws.send(JSON.stringify({ type: 'JOIN_SUCCESS', payload: { roomId, userId: uid, users: roomdetails.users } }));
                broadcastRoom(roomId,"JOINED_ROOM");
            }
            //! 3. update fucntion takes userid , location cordinates
            if (type === 'UPDATE_LOCATION') {
                const { userId, location } = payload;
                const { roomId } = socketMap[ws.id] || {};
                const room = getRoom(roomId);
                if (!room || !room.users[userId]) return;

                room.users[userId].location = location;
                room.users[userId].lastUpdated = new Date();

                broadcastRoom(roomId,"UPDATED_ROOM");
            }
            //! 4. can leave room ( not admin)
            if (type === 'LEAVE_ROOM') {
                handleDisconnect(ws);
            }
            //! 5. can delete or terimate room ( only admin)
           
            if (type === 'TERMINATE_ROOM') {
                const { roomId } = socketMap[ws.id] || {};
                const room = getRoom(roomId);

                if (room && room.createdBy === payload.userId) {
                    // 1️⃣ Broadcast termination
                    broadcastRoom(roomId,'TERMINATED_ROOM');

                    // 2️⃣ Clean up socketMap and close connections
                    Object.values(room.users).forEach(user => {
                        const client = [...wss.clients].find(c => c.id === user.socketId);
                        if (client) {
                            delete socketMap[client.id];
                            client.close(); // ⛔ closes the WebSocket connection
                        }
                    });

                    // 3️⃣ Delete room
                    deleteRoom(roomId);
                } else {
                    ws.send(JSON.stringify({
                        type: 'ERROR',
                        payload: { message: 'Only the creator can terminate the room.' }
                    }));
                }
            }


        });

        ws.on('close', () => {
            handleDisconnect(ws);
        });

        function handleDisconnect(ws) {
            const { roomId, userId } = socketMap[ws.id] || {};
            if (!roomId || !userId) return;

            const room = getRoom(roomId);//rooms[roomId]
            if (room?.users[userId]) {
                delete room.users[userId];
                broadcastRoom(roomId,"DISCONNECT_ROOM");
            }

            delete socketMap[ws.id];
        }

        function broadcastRoom(roomId,mess) {
            const room = getRoom(roomId);
            if (!room) return;

            const message = {
                type: mess,
                payload: { users: room.users }
            };//
            //? Loop through all connected WebSocket clients.   wss.clients is built-in — it's a Set of all active WebSocket connections.
            //! O(N)
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    const { roomId: clientRoomId } = socketMap[client.id] || {};
                    if (clientRoomId === roomId) {
                        client.send(JSON.stringify(message));
                    }
                }
            });
        }

    });
}

module.exports = { setupWebSocket, socketMap };
