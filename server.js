const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with CORS
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for now, or specify: ["https://your-domain.com"]
        methods: ["GET", "POST"]
    }
});

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Store waiting users
let waitingUsers = [];
let onlineCount = 0;

// Universal broadcast function
const broadcastOnlineCount = () => {
    io.emit('online_count', onlineCount);
};

io.on('connection', (socket) => {
    onlineCount++;
    console.log(`User ${socket.id} connected. Total online: ${onlineCount}`);
    broadcastOnlineCount();


    // User wants to find a match
    socket.on('find_match', () => {
        // Prevent double queueing or matching if already in a room
        if (socket.roomId || socket.peerId) return;

        // Remove from waiting queue if already there (extra safety)
        waitingUsers = waitingUsers.filter(user => user.id !== socket.id);

        if (waitingUsers.length > 0) {
            // Someone is waiting, pair them up!
            const partner = waitingUsers.shift();

            // Check if partner is still connected (edge case)
            if (!io.sockets.sockets.get(partner.id)) {
                // Partner disconnected while waiting, try again
                socket.emit('status', 'Partner disconnected, searching again...');
                // Recursive call or just add to queue? Let's keep it simple: just re-queue current user
                waitingUsers.push(socket);
                return;
            }

            const roomId = `room_${socket.id}_${partner.id}`;

            // Join both to a unique room
            socket.join(roomId);
            partner.join(roomId);

            // Store peer ID on socket object for easy lookup
            socket.peerId = partner.id;
            partner.peerId = socket.id;

            socket.roomId = roomId;
            partner.roomId = roomId;

            // Notify both users - assign one as initiator
            socket.emit('match_found', { roomId, isInitiator: true });
            partner.emit('match_found', { roomId, isInitiator: false });

            console.log(`Matched ${socket.id} with ${partner.id}`);

        } else {
            // No one waiting, add to queue
            waitingUsers.push(socket);
            socket.emit('waiting', 'Looking for a partner...');
            console.log(`User ${socket.id} added to waiting queue.`);
        }
    });

    // Handle messages
    socket.on('message', (msg) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('message', {
                text: msg,
                sender: 'partner'
            });
        }
    });

    // Handle typing indicators
    socket.on('typing', () => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('typing');
        }
    });

    socket.on('stop_typing', () => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('stop_typing');
        }
    });

    // WebRTC Signaling
    socket.on('signal', (data) => {
        if (socket.peerId) {
            console.log(`Relaying signal from ${socket.id} to ${socket.peerId}:`, Object.keys(data));
            io.to(socket.peerId).emit('signal', data);
        } else {
            console.warn(`Signal received from ${socket.id} but no peerId found.`);
        }
    });

    // Handle disconnect (manual or closing tab)
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        // Remove from waiting queue if present
        waitingUsers = waitingUsers.filter(user => user.id !== socket.id);

        if (socket.peerId) {
            // Notify partner
            const partnerSocket = io.sockets.sockets.get(socket.peerId);
            if (partnerSocket) {
                partnerSocket.emit('partner_disconnected');
                partnerSocket.leave(socket.roomId);
                partnerSocket.peerId = null;
                partnerSocket.roomId = null;
            }
        }

        onlineCount = Math.max(0, onlineCount - 1);
        console.log(`User ${socket.id} disconnected. Total online: ${onlineCount}`);
        broadcastOnlineCount();
    });

    // Allow manual disconnect from UI
    socket.on('manual_disconnect', () => {
        console.log(`Manual disconnect requested by ${socket.id}`);

        // 1. Remove from waiting queue
        waitingUsers = waitingUsers.filter(user => user.id !== socket.id);

        // 2. Clear current room/peer associations
        if (socket.peerId) {
            const partnerSocket = io.sockets.sockets.get(socket.peerId);
            if (partnerSocket) {
                partnerSocket.emit('partner_disconnected');
                if (socket.roomId) {
                    partnerSocket.leave(socket.roomId);
                }
                partnerSocket.peerId = null;
                partnerSocket.roomId = null;
            }
        }

        if (socket.roomId) {
            socket.leave(socket.roomId);
        }
        socket.peerId = null;
        socket.roomId = null;
        socket.emit('disconnected_local');
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

