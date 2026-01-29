const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);

// SERVER VERSION 2.5
console.log("GLOBAL_CONNECT_SERVER: v2.5 Starting...");

// Initialize Socket.IO with CORS
const io = new Server(server, {
    cors: { origin: "*" }
});

// Force HTTPS Redirection for Render
app.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
});

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

let waitingUsers = [];
let onlineCount = 0;

const broadcastOnlineCount = () => {
    io.emit('online_count', onlineCount);
};

io.on('connection', (socket) => {
    onlineCount++;
    console.log(`User ${socket.id} connected. Total online: ${onlineCount}`);
    broadcastOnlineCount();

    socket.on('find_match', () => {
        if (socket.roomId || socket.peerId) return;
        waitingUsers = waitingUsers.filter(user => user.id !== socket.id);

        let partner = null;
        while (waitingUsers.length > 0) {
            const potentialPartner = waitingUsers.shift();
            if (io.sockets.sockets.has(potentialPartner.id)) {
                partner = potentialPartner;
                break;
            }
        }

        if (partner) {
            const roomId = `room_${socket.id}_${partner.id}`;
            socket.join(roomId);
            partner.join(roomId);
            socket.peerId = partner.id;
            partner.peerId = socket.id;
            socket.roomId = roomId;
            partner.roomId = roomId;
            socket.emit('match_found', { roomId, isInitiator: true });
            partner.emit('match_found', { roomId, isInitiator: false });
        } else {
            waitingUsers.push(socket);
            socket.emit('waiting', 'Looking for a partner...');
        }
    });

    socket.on('message', (msg) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('message', { text: msg, sender: 'partner' });
        }
    });

    socket.on('typing', () => {
        if (socket.roomId) socket.to(socket.roomId).emit('typing');
    });

    socket.on('stop_typing', () => {
        if (socket.roomId) socket.to(socket.roomId).emit('stop_typing');
    });

    socket.on('signal', (data) => {
        if (socket.peerId) {
            io.to(socket.peerId).emit('signal', data);
        }
    });

    socket.on('disconnect', () => {
        waitingUsers = waitingUsers.filter(user => user.id !== socket.id);
        if (socket.peerId) {
            const partnerSocket = io.sockets.sockets.get(socket.peerId);
            if (partnerSocket) {
                partnerSocket.emit('partner_disconnected');
                partnerSocket.leave(socket.roomId);
                partnerSocket.peerId = null;
                partnerSocket.roomId = null;
            }
        }
        onlineCount = Math.max(0, onlineCount - 1);
        broadcastOnlineCount();
    });

    socket.on('manual_disconnect', () => {
        waitingUsers = waitingUsers.filter(user => user.id !== socket.id);
        if (socket.peerId) {
            const partnerSocket = io.sockets.sockets.get(socket.peerId);
            if (partnerSocket) {
                partnerSocket.emit('partner_disconnected');
                if (socket.roomId) partnerSocket.leave(socket.roomId);
                partnerSocket.peerId = null;
                partnerSocket.roomId = null;
            }
        }
        if (socket.roomId) socket.leave(socket.roomId);
        socket.peerId = null;
        socket.roomId = null;
        socket.emit('disconnected_local');
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server v2.5 running on ${PORT}`);
});
