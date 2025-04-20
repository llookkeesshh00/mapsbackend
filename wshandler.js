const { rooms, createRoom, getRoom, deleteRoom } = require('./room.js');
const { v4: uuidv4 } = require('uuid');

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
      } catch {
        return sendError(ws, 'Invalid JSON received');
      }

      const { type, payload } = data;

      switch (type) {
        case 'CREATE_ROOM': {
          const { name, location, destination } = payload;
          const userId = ws.id;
          const roomId = createRoom(userId);
          const room = getRoom(roomId);

          const now = new Date();
          const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

          room.destination = destination; // { latitude, longitude }
          room.createdBy = userId;
          room.createdAt = now.toISOString();
          room.users[userId] = {
            socketId: ws.id,
            name,
            location, // { latitude, longitude }
            joinedAt: formatTime(now),
            lastUpdated: formatTime(fiveMinutesAgo),
          };

          socketMap[ws.id] = { roomId, userId };

          broadcastRoom('CREATED_ROOM', roomId);
          ws.send(JSON.stringify({
            type: 'USER_ID_ASSIGNED',
            payload: { userId }
          }));
          break;
        }

        case 'JOIN_ROOM': {
          const { roomId, name, location } = payload;
          const room = getRoom(roomId);
          if (!room) return sendError(ws, 'Room not found');

          if (socketMap[ws.id]?.roomId && socketMap[ws.id].roomId !== roomId) {
            handleDisconnect(ws);
          }

          const userId = uuidv4();
          const now = new Date();
          room.users[userId] = {
            socketId: ws.id,
            name,
            location, // { latitude, longitude }
            joinedAt: formatTime(now),
            lastUpdated: formatTime(new Date(now.getTime() - 5 * 60 * 1000)),
          };

          socketMap[ws.id] = { roomId, userId };

          broadcastRoom('JOIN_SUCCESS', roomId);
          ws.send(JSON.stringify({
            type: 'USER_ID_ASSIGNED',
            payload: { userId }
          }));
          break;
        }

        case 'UPDATE_LOCATION': {
          const { userId, location } = payload;
          const roomId = socketMap[ws.id]?.roomId;
          const room = getRoom(roomId);
          if (!room || !room.users[userId]) return;

          room.users[userId].location = location; // { latitude, longitude }
          room.users[userId].lastUpdated = formatTime(new Date());

          broadcastRoom('UPDATED_LOCATION', roomId);
          break;
        }

        case 'UPDATE_ROUTE': {
          const { roomId, userId, route } = payload;
          const room = getRoom(roomId);
          if (!room || !room.users[userId]) return sendError(ws, 'Invalid room or user');

          room.users[userId].route = {
            points: route.points, // Array of { latitude, longitude }
            duration: route.duration,
            distance: route.distance,
            mode: route.mode // e.g., "walking", "driving"
          };

          broadcastRoom('UPDATE_ROUTE', roomId, { userId, route });
          break;
        }

        case 'LEAVE_ROOM': {
          const { roomId, userId } = payload;
          const room = getRoom(roomId);
          if (!room) return sendError(ws, 'Room not found');
          if (!room.users[userId]) return sendError(ws, 'User not found in room');

          handleDisconnect(ws); // Let handleDisconnect handle everything
          break;
        }

        case 'GET_ROOM_DETAILS': {
          const { roomId } = payload;
          const room = getRoom(roomId);
          if (!room) return sendError(ws, 'Room not found');

          broadcastRoom('ROOM_DETAILS', roomId);
          break;
        }

        case 'TERMINATE_ROOM': {
          const { roomId, userId } = payload;
          const room = getRoom(roomId);
          if (!room) return sendError(ws, 'Room not found');
          if (room.createdBy !== userId) return sendError(ws, 'Only the room creator can terminate it');

          broadcastRoom('ROOM_TERMINATED', roomId, {}, true); // Minimal payload

          // Clean up all clients in the room
          wss.clients.forEach(client => {
            const clientData = socketMap[client.id];
            if (clientData?.roomId === roomId) {
              handleDisconnect(client, true); // Skip USER_LEFT broadcast
            }
          });

          deleteRoom(roomId);
          console.log("Room terminated:", roomId);
          break;
        }

        default:
          sendError(ws, 'Unknown message type');
      }
    });

    ws.on('close', () => {
      console.log("🔌 Socket disconnected:", ws.id);
      handleDisconnect(ws); // Handle unexpected disconnections
    });

    function handleDisconnect(ws, skipUserLeftBroadcast = false) {
      const socketData = socketMap[ws.id];
      if (!socketData) return; // No socket data to clean up

      const { roomId, userId } = socketData;
      const room = getRoom(roomId);
      const username = room?.users[userId]?.name || 'Unknown User';

      if (room && room.users[userId]) {
        delete room.users[userId]; // Remove user from room
        if (!skipUserLeftBroadcast) {
          broadcastRoom('USER_LEFT', roomId, { userId, username  }); // Notify others only if not skipped
        }
      }

      // Skip room deletion in TERMINATE_ROOM to avoid premature deletion
      if (!skipUserLeftBroadcast && room && Object.keys(room.users).length === 0) {
        deleteRoom(roomId);
        console.log(`Room ${roomId} deleted as it is empty`);
      }

      delete socketMap[ws.id]; // Remove from socketMap
      console.log(`Socket ${ws.id} cleaned up from room ${roomId}`);
    }

    function broadcastRoom(type, roomId, extraPayload = {}, minimal = false) {
      const room = getRoom(roomId);
      if (!room) return;

      const message = JSON.stringify({
        type,
        payload: minimal
          ? { roomId, ...extraPayload }
          : {
              roomId,
              users: room.users,
              destination: room.destination,
              createdAt: room.createdAt,
              createdBy: room.createdBy,
              ...extraPayload
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

    function sendError(ws, message, code = 'UNKNOWN') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        payload: { message, code }
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