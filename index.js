const express = require('express');
const cors = require('cors');
const http = require('http');

const { PrismaClient } = require('@prisma/client');
const {setupWebSocket,socketMap }=require('./wshandler')
const { rooms } = require('./room.js');


const app = express();
const prisma = new PrismaClient();
//this app(express http) server is attached to the websocket server
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

app.get('/home', async (req, res) => {
  res.json('backend is running!!')
});
app.get('/room-details', async (req, res) => {
  res.json(rooms)
});
app.get('/socket-details', async (req, res) => {
  res.json(socketMap)
});

app.get('/room-destination-cord:roomId',async(req,res)=>{
  const { roomId } = req.params;
  if (!room || !room.destination) {
    return res.status(404).json({ error: "Room or destination not found" });
}

  const dest = rooms[roomId].destination
   res.json(dest)
})
setupWebSocket(server);
//now make ws servr listen as it is binded with http
server.listen(3001, () => {
  console.log('ws running on http://localhost:3001');
});
