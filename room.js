
const rooms = {};
//roomid:{ metadata,users array}

function createRoom(createdBy) {
  const roomId = generateRoomId(); 
  rooms[roomId] = {
    createdAt: new Date(),
    createdBy, // filled when first user joins
    users: {} // userId -> { socketId, location, name }
  };
  return roomId;
}

function deleteRoom(roomId) {
  delete rooms[roomId];
}

function getRoom(roomId) {
  return rooms[roomId];
}

function generateRoomId() {
  return Math.random().toString().slice(2, 8); // 6-digit ID
}

module.exports = {
  rooms,
  createRoom,
  deleteRoom,
  getRoom,
};
