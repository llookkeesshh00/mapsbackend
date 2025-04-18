const { rooms, createRoom, getRoom, deleteRoom } = require('./room.js');
const { v4: uuidv4 } = require('uuid');

// Data lost on restart is expected without a DB or persistent store
const socketMap = {}; // socketId -> { roomId, userId }

function setupWebSocket(server) {
  const WebSocket = require('ws');
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    ws.id = uuidv4();
    console.log("🔌 New socket connected:", ws.id);

    ws.on('message', (message) => {
      let data;
      try {
        data = JSON.parse(message);
      } catch (err) {
        console.warn(" Invalid JSON received");
        return;
      }

      const { type, payload } = data;

      switch (type) {
        case 'CREATE_ROOM': {
          const { name, location, destination, placeId } = payload;
          const userId = uuidv4();
          const roomId = createRoom(userId);
          const room = getRoom(roomId);

          const now = new Date();
          const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
          const lastUpdated = formatTime(fiveMinutesAgo);

          room.destination = destination;
          room.placeId = placeId;
          room.createdBy = userId;
          room.createdAt = now.toISOString();
          room.users[userId] = {
            socketId: ws.id,
            name,
            location,
            joinedAt: formatTime(now),
            lastUpdated,
          };

          socketMap[ws.id] = { roomId, userId };

          ws.send(JSON.stringify({
            type: 'CREATED_ROOM',
            payload: { roomId, userId, users: room.users, destination: room.destination, route: room.route }
          }));

          broadcastRoom(roomId, 'UPDATED_ROOM');
          break;
        }

        case 'JOIN_ROOM': {
          const { roomId, name, location } = payload;
          const room = getRoom(roomId);
          if (!room) {
            return sendError(ws, 'Room not found');
          }

          if (socketMap[ws.id]?.roomId === roomId) {
            return sendError(ws, 'You have already joined this room.');
          }

          const userId = uuidv4();
          const now = new Date();
          const lastUpdated = formatTime(new Date(now.getTime() - 5 * 60 * 1000));

          room.users[userId] = {
            socketId: ws.id,
            name,
            location,
            joinedAt: formatTime(now),
            lastUpdated,
          };

          socketMap[ws.id] = { roomId, userId };

          ws.send(JSON.stringify({
            type: 'JOIN_SUCCESS',
            payload: { roomId, userId, users: room.users, destination: room.destination, route: room.route }
          }));

          broadcastRoom(roomId, 'UPDATED_ROOM');
          break;
        }

        case 'UPDATE_LOCATION': {
          const { userId, location } = payload;
          const roomId = socketMap[ws.id]?.roomId;
          const room = getRoom(roomId);
          if (!room || !room.users[userId]) return;

          room.users[userId].location = location;
          room.users[userId].lastUpdated = formatTime(new Date());

          broadcastRoom(roomId, 'UPDATED_ROOM');
          break;
        }

        case 'UPDATE_ROUTE': {
          const { roomId, userId , route } = payload;
          const room = getRoom(roomId);
          if (!room) {
            return sendError(ws, 'Room not found');
          }

          room.users[userId].route ={
            points: route.points,
            duration: route.duration,
            distance: route.distance,
            mode: route.mode
          };

          // Broadcast updated room with route to all users
          broadcastRoom(roomId, 'UPDATE_ROUTE');
          break;
        }

        case 'LEAVE_ROOM': {
          handleDisconnect(ws);
          break;
        }

        case 'TERMINATE_ROOM': {
          const { roomId } = socketMap[ws.id] || {};
          const room = getRoom(roomId);
          const { userId } = payload;

          if (room && room.createdBy === userId) {
            broadcastRoom(roomId, 'ROOM_TERMINATED');

            // Close all user sockets
            Object.values(room.users).forEach(user => {
              const client = [...wss.clients].find(c => c.id === user.socketId);
              if (client) {
                delete socketMap[client.id];
                client.close(); // disconnect socket
              }
            });

            deleteRoom(roomId);
            console.log("Room terminated:", roomId);
          } else {
            sendError(ws, 'Only the room creator can terminate it.');
          }
          break;
        }

        default:
          sendError(ws, 'Unknown message type');
          break;
      }
    });

    ws.on('close', () => {
      handleDisconnect(ws);
    });

    // ======================
    // Helper Functions
    // ======================

    function handleDisconnect(ws) {
      const { roomId, userId } = socketMap[ws.id] || {};
      if (!roomId || !userId) return;

      const room = getRoom(roomId);
      if (room?.users[userId]) {
        delete room.users[userId];
        broadcastRoom(roomId, 'UPDATED_ROOM');
      }

      delete socketMap[ws.id];
    }

    function broadcastRoom(roomId, type) {
      const room = getRoom(roomId);
      if (!room) return;

      const message = JSON.stringify({
        type,
        payload: {
          users: room.users,
          destination: room.destination,
          route: room.route // Include route in broadcast
        }
      });

      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          const clientRoomId = socketMap[client.id]?.roomId;
          if (clientRoomId === roomId) {
            client.send(message);
          }
        }
      });
    }

    function sendError(ws, message) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        payload: { message }
      }));
    }

    function formatTime(date) {
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: false,
      });
    }
  });
}

module.exports = { setupWebSocket, socketMap };