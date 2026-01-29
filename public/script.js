const socket = io();

// UI Elements
const startScreen = document.getElementById('start-screen');
const waitingScreen = document.getElementById('waiting-screen');
const chatScreen = document.getElementById('chat-screen');
const startBtn = document.getElementById('start-btn');
const nextBtn = document.getElementById('next-btn'); // Renamed from disconnectBtn
const howItWorksBtn = document.getElementById('how-it-works-btn');
const howItWorksSection = document.getElementById('how-it-works');
const sendBtn = document.getElementById('send-btn');
const messageInput = document.getElementById('message-input');
const messagesContainer = document.getElementById('messages');
const remoteAudio = document.getElementById('remote-audio');
const muteBtn = document.getElementById('mute-btn');
const callStatus = document.getElementById('call-status');
const callTimer = document.getElementById('call-timer');
const topicBanner = document.getElementById('topic-banner');
const topicText = document.getElementById('topic-text');
const partnerAvatar = document.getElementById('partner-avatar');
const charCounter = document.getElementById('char-counter');
const reportBtn = document.getElementById('report-btn');
const stopBtn = document.getElementById('stop-btn');
const cancelWaitingBtn = document.getElementById('cancel-waiting-btn');
const userCountDisplay = document.getElementById('user-count');

// Basic Profanity Filter (English)
const badWords = ['badword1', 'badword2', 'spam', 'scam']; // Extend as needed
function containsProfanity(text) {
    const lower = text.toLowerCase();
    return badWords.some(word => lower.includes(word));
}

// Sound System
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSystemSound(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;
    if (type === 'connect') {
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
    } else if (type === 'message') {
        osc.frequency.setValueAtTime(800, now);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
    } else if (type === 'disconnect') {
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.2);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
    }
}

const topics = [
    "Travel & Fun ✈️", "Favorite Movies 🎬", "Your Dreams 🚀",
    "Food & Cooking 🍕", "Music Taste 🎵", "Holidays 🎄",
    "Computers & Tech 🤖", "Books & Reading 📚", "Sports & Fitness ⚽",
    "Dream Jobs 💼", "Video Games 🎮", "When you were a child 🧸",
    "Outer Space 🌌", "Art & Creativity 🎨", "Coffee or Tea? ☕",
    "Pets & Animals 🐾", "Old History 🏺", "Clothes & Fashion 👗",
    "Taking Photos 📸", "Superpowers 🦸", "Perfect Weekend 🏖️",
    "Hidden Talents 🌟", "First Concert 🎙️", "Things you want to do 📝"
];

let currentRoomId = null;
let localStream = null;
let peerConnection = null;
let isMuted = false;
let startTime = null;
let timerInterval = null;
let isInitializing = false;
let audioContext = null;
let audioAnalyser = null;
let animationId = null;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' }
    ],
    // This forces the connection to try harder to find a path through firewalls
    iceCandidatePoolSize: 10
};

// Helpers
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        s.classList.add('hidden');
    });
    const screen = document.getElementById(screenId);
    screen.classList.remove('hidden');
    screen.classList.add('active');

    if (screenId === 'chat-screen') {
        topicBanner.classList.remove('hidden');
        setRandomTopic();
    } else {
        topicBanner.classList.add('hidden');
    }
}

// Rotate topics frequently to keep it fresh
function setRandomTopic() {
    const randomTopic = topics[Math.floor(Math.random() * topics.length)];
    topicText.innerText = randomTopic;
}

// Auto-rotate topic every 7 minutes
setInterval(setRandomTopic, 420000);

function addMessage(text, type) {
    const div = document.createElement('div');
    if (type === 'system') {
        div.className = 'system-msg';
        div.innerText = text;
    } else {
        div.className = `msg ${type}`;
        div.innerText = text;
    }
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Event Listeners
startBtn.addEventListener('click', () => {
    showScreen('waiting-screen');
    socket.emit('find_match');
});

if (howItWorksBtn) {
    howItWorksBtn.addEventListener('click', () => {
        howItWorksSection.classList.toggle('hidden');
        howItWorksSection.scrollIntoView({ behavior: 'smooth' });
    });
}

nextBtn.addEventListener('click', () => {
    // "Next Partner" flow: Disconnect -> Cleanup -> Find New
    socket.emit('manual_disconnect');
    endSession();

    // Immediate rematch
    showScreen('waiting-screen');
    socket.emit('find_match');
});

if (reportBtn) {
    reportBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to report and skip this person?')) {
            addMessage('User reported. Finding someone new...', 'system');
            socket.emit('manual_disconnect');
            setTimeout(() => {
                endSession();
                showScreen('waiting-screen');
                socket.emit('find_match');
            }, 1000);
        }
    });
}

if (stopBtn) {
    stopBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to stop the live session and leave?')) {
            socket.emit('manual_disconnect');
            endSession();
            playSystemSound('disconnect');
        }
    });
}

if (cancelWaitingBtn) {
    cancelWaitingBtn.addEventListener('click', () => {
        socket.emit('manual_disconnect');
        endSession();
    });
}

// Character Counter Logic
messageInput.addEventListener('input', () => {
    const len = messageInput.value.length;
    charCounter.innerText = `${len}/200`;
    charCounter.classList.toggle('limit', len >= 190);
});

muteBtn.addEventListener('click', toggleMute);

function endSession() {
    console.log('Ending session and cleaning up resources...');
    stopTimer();
    stopVisualizer();
    if (peerConnection) {
        peerConnection.onicecandidate = null;
        peerConnection.ontrack = null;
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    showScreen('start-screen');
    messagesContainer.innerHTML = '';
    currentRoomId = null;
    callStatus.innerText = 'Connecting...';
    callTimer.innerText = '00:00';
    muteBtn.classList.remove('muted');
    const icon = muteBtn.querySelector('i');
    if (icon) {
        icon.classList.remove('fa-microphone-slash');
        icon.classList.add('fa-microphone');
    }
    isMuted = false;
}

function toggleMute() {
    isMuted = !isMuted;
    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            track.enabled = !isMuted;
        });
    }
    muteBtn.classList.toggle('muted', isMuted);

    // Update icon
    const icon = muteBtn.querySelector('i');
    if (icon) {
        if (isMuted) {
            icon.classList.remove('fa-microphone');
            icon.classList.add('fa-microphone-slash');
        } else {
            icon.classList.remove('fa-microphone-slash');
            icon.classList.add('fa-microphone');
        }
    }
}

function startTimer() {
    startTime = Date.now();
    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const secs = String(elapsed % 60).padStart(2, '0');
        callTimer.innerText = `${mins}:${secs}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
}

function initVisualizer(stream) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Resume context if suspended (browser policy)
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(stream);
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 32;
    source.connect(audioAnalyser);

    drawVisualizer();
}

function drawVisualizer() {
    if (!audioAnalyser) return;

    const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
    const bars = document.querySelectorAll('.bar');

    function animate() {
        if (!audioAnalyser) return;
        animationId = requestAnimationFrame(animate);
        audioAnalyser.getByteFrequencyData(dataArray);

        // Map audio data to bars
        if (bars.length >= 4) {
            // More sensitive mapping
            const sensitivity = 1.2;
            const v1 = (dataArray[1] / 255) * sensitivity;
            const v2 = (dataArray[3] / 255) * sensitivity;
            const v3 = (dataArray[5] / 255) * sensitivity;
            const v4 = (dataArray[7] / 255) * sensitivity;

            bars[0].style.height = `${15 + (Math.min(v1, 1) * 85)}%`;
            bars[1].style.height = `${15 + (Math.min(v2, 1) * 85)}%`;
            bars[2].style.height = `${15 + (Math.min(v3, 1) * 85)}%`;
            bars[3].style.height = `${15 + (Math.min(v4, 1) * 85)}%`;

            // Add subtle glow based on volume
            const avg = (v1 + v2 + v3 + v4) / 4;
            bars.forEach(bar => {
                bar.style.opacity = 0.5 + (avg * 0.5);
            });
        }
    }
    animate();
}

function stopVisualizer() {
    if (animationId) cancelAnimationFrame(animationId);
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().then(() => { audioContext = null; });
    }
    audioAnalyser = null;
    document.querySelectorAll('.bar').forEach(bar => {
        bar.style.height = '20%';
        bar.style.opacity = '0.5';
    });
}

sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

function sendMessage() {
    const text = messageInput.value.trim();
    if (text) {
        if (containsProfanity(text)) {
            addMessage('Please be respectful. Avoid offensive language.', 'system');
            return;
        }
        socket.emit('message', text);
        addMessage(text, 'sent');
        messageInput.value = '';
        charCounter.innerText = '0/200';
        messageInput.focus();
    }
}

// Mobile helper: Scroll to input on focus
messageInput.addEventListener('focus', () => {
    setTimeout(() => {
        messageInput.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 300);
});

// Socket Events
socket.on('connect', () => {
    console.log('Connected to server. Waiting for count...');
});

socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err);
    if (userCountDisplay) userCountDisplay.innerText = 'Offline';
});

socket.on('online_count', (count) => {
    console.log('Live Online Count Received:', count);
    if (userCountDisplay) {
        userCountDisplay.innerText = `${count} People Online`;
    }
});

socket.on('waiting', (msg) => {
    console.log(msg);
    // Already on waiting screen
});

let signalQueue = [];

socket.on('match_found', async (data) => {
    console.log('Match found! Initiator:', data.isInitiator);
    currentRoomId = data.roomId;

    // Set dynamic avatar based on roomId to make it unique per session
    if (partnerAvatar) {
        partnerAvatar.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.roomId}`;
    }

    showScreen('chat-screen');
    addMessage('Connected! Say hello.', 'system');
    setTimeout(() => {
        addMessage('Tip: Be polite and keep it friendly! 🌍', 'system');
    }, 1500);

    // Initialize WebRTC
    await initWebRTC(data.isInitiator);
});

async function initWebRTC(isCaller) {
    if (isInitializing) return;
    isInitializing = true;

    try {
        console.log('Requesting microphone...');
        callStatus.innerText = 'Please allow microphone...';

        // Try current API, then fallbacks
        const mediaDevices = navigator.mediaDevices || {};
        const getUserMedia = mediaDevices.getUserMedia ||
            navigator.webkitGetUserMedia ||
            navigator.mozGetUserMedia ||
            navigator.msGetUserMedia;

        if (!getUserMedia) {
            throw new Error('Microphone blocked by browser security (Network not trusted).');
        }

        // Use Promise-based version if available, else wrap callback version
        if (mediaDevices.getUserMedia) {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
            localStream = await new Promise((res, rej) => getUserMedia.call(navigator, { audio: true }, res, rej));
        }
        console.log('Mic access granted.');

        callStatus.innerText = 'Connecting...';
        peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        });

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        // Monitor connection state - Detailed UI updates
        peerConnection.oniceconnectionstatechange = () => {
            const state = peerConnection.iceConnectionState;
            console.log('ICE Connection State:', state);

            if (state === 'checking') {
                callStatus.innerText = 'Finding person...';
            } else if (state === 'connected' || state === 'completed') {
                callStatus.innerText = 'Connected - Speaking';
            } else if (state === 'failed' || state === 'disconnected') {
                callStatus.innerText = 'Connection Failed';
                addMessage('Call failed. Try disabling Wi-Fi isolation or Firewalls.', 'system');
            } else {
                callStatus.innerText = 'Status: ' + state;
            }
        };

        peerConnection.ontrack = (event) => {
            console.log('Got remote audio');
            // We must take the audio stream from the event and give it to the 'remote-audio' element
            remoteAudio.srcObject = event.streams[0];
            callStatus.innerText = 'Connected - Speaking';
            startTimer();
            initVisualizer(event.streams[0]);
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('signal', { candidate: event.candidate });
            }
        };

        // Process signals that arrived while getting mic
        console.log(`Processing ${signalQueue.length} queued signals`);
        while (signalQueue.length > 0) {
            const data = signalQueue.shift();
            await handleSignal(data);
        }

        if (isCaller) {
            console.log('Creating offer...');
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('signal', { offer });
        }
        playSystemSound('connect');
    } catch (err) {
        console.error('WebRTC Error:', err);
        let errorMsg = err.message;
        if (err.name === 'NotAllowedError') {
            errorMsg = 'Microphone access denied. Please allow it in browser settings.';
        } else if (err.name === 'NotFoundError') {
            errorMsg = 'No microphone found on your device.';
        } else if (err.name === 'NotReadableError') {
            errorMsg = 'Microphone is already in use by another app.';
        }
        callStatus.innerText = 'Error: ' + errorMsg;
        addMessage(`Call setup failed: ${errorMsg}`, 'system');
    } finally {
        isInitializing = false;
    }
}

socket.on('signal', async (data) => {
    if (!peerConnection || isInitializing) {
        console.log('Queueing signal');
        signalQueue.push(data);
    } else {
        await handleSignal(data);
    }
});

async function handleSignal(data) {
    console.log('Handling signal:', Object.keys(data));
    if (data.offer) {
        console.log('Setting remote description (offer)...');
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        console.log('Creating answer...');
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        console.log('Sending answer...');
        socket.emit('signal', { answer });
    } else if (data.answer) {
        console.log('Setting remote description (answer)...');
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } else if (data.candidate) {
        console.log('Adding ICE candidate...');
        if (peerConnection && peerConnection.remoteDescription) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (e) {
                console.error('Error adding candidate', e);
            }
        } else {
            console.log('Queueing candidate (no remote desc yet)');
            signalQueue.push(data);
        }
    }
}

socket.on('message', (data) => {
    addMessage(data.text, 'received');
    playSystemSound('message');
});

socket.on('typing', () => {
    let typingIndicator = document.getElementById('typing-indicator');
    if (!typingIndicator) {
        typingIndicator = document.createElement('div');
        typingIndicator.id = 'typing-indicator';
        typingIndicator.className = 'system-msg';
        typingIndicator.innerText = 'your partner is typing...';
        typingIndicator.style.opacity = '0.7';
        messagesContainer.appendChild(typingIndicator);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
});

socket.on('stop_typing', () => {
    const typingIndicator = document.getElementById('typing-indicator');
    if (typingIndicator) typingIndicator.remove();
});

let typingTimeout;
messageInput.addEventListener('input', () => {
    socket.emit('typing');
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('stop_typing');
    }, 1000);
});

socket.on('partner_disconnected', () => {
    addMessage('your partner left. Finding someone new...', 'system');
    setTimeout(() => {
        endSession();
        // Optional: Auto-search?
        // showScreen('waiting-screen');
        // socket.emit('find_match');
    }, 2000);
});

socket.on('disconnected_local', () => {
    // Confirmed disconnect from server
});

