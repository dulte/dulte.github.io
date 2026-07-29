let peerConnection;

let uid = String(Math.floor(Math.random() * 10000))
let token = null;
let client;

let servers = {
    iceServers: [
        {
            urls: ['stun:stun1.1.google.com:19302', 'stun:stun2.1.google.com:19302']
        }
    ]
}