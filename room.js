const rooms = {};

function createRoom(createdBy) {
  const roomId = generateRoomId();
  rooms[roomId] = {
    createdAt: new Date(),
    createdBy,
    users: {},
    destination: { latitude: null, longitude: null },
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