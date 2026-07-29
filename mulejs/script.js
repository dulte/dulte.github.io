const pillBtns = document.querySelectorAll('.pill-btn');
const pillIndicator = document.querySelector('.pill-indicator');
const panel = document.getElementById('panel');

const senderControls = document.getElementById('senderControls');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const fileNameField = document.getElementById('fileName');
const fileInfo = document.getElementById('fileInfo');

const localSdpWrap = document.getElementById('localSdpWrap');
const localSdp = document.getElementById('localSdp');
const copyLocalBtn = document.getElementById('copyLocalBtn');
const regenBtn = document.getElementById('regenBtn');

const pasteWrap = document.getElementById('pasteWrap');
const remoteSdp = document.getElementById('remoteSdp');
const pasteLabel = document.getElementById('pasteLabel');
const applyRemoteBtn = document.getElementById('applyRemoteBtn');
const sendFileBtn = document.getElementById('sendFileBtn');

const transferControls = document.getElementById('transferControls');
const pauseResumeBtn = document.getElementById('pauseResumeBtn');
const cancelBtn = document.getElementById('cancelBtn');
const transferStatus = document.getElementById('transferStatus');

const receiverResult = document.getElementById('receiverResult');
const receiverSdp = document.getElementById('receiverSdp');
const copyReceiverBtn = document.getElementById('copyReceiverBtn');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');

const aboutBtn = document.getElementById('aboutBtn');
const aboutOverlay = document.getElementById('aboutOverlay');
const aboutClose = document.getElementById('aboutClose');

let mode = 'send';
let selectedFile = null;

let senderPc = null;
let senderDataChannel = null;
let senderKeyPair = null;
let senderAesKey = null;

let receiverPc = null;
let receiverAesKey = null;
let recvChunks = [];
let recvBytes = 0;
let expectedBytes = 0;
let recvFilename = 'received.dat';
let recvChecksum = null;

let sendingPaused = false;
let sendingCancelled = false;
let recentSamples = [];

const pcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
};

function show(el) {
    el.classList.remove('hidden');
}

function hide(el) {
    el.classList.add('hidden');
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function closePeerConnection(pc) {
    if (!pc) return;
    try {
        pc.close();
    } catch {
        // ignore
    }
}

function setTransferStatus(text) {
    transferStatus.textContent = text;
}

function setReceiverProgressText(text) {
    progressText.textContent = text;
}

function updatePill() {
    const active = document.querySelector('.pill-btn[aria-pressed="true"]');
    if (!active) return;

    const rect = active.getBoundingClientRect();
    const parentRect = active.parentElement.getBoundingClientRect();

    pillIndicator.style.width = rect.width + 'px';
    pillIndicator.style.transform = `translateX(${rect.left - parentRect.left}px)`;
    panel.dataset.mode = active.dataset.mode;
}

function resetUiState() {
    hide(localSdpWrap);
    hide(pasteWrap);
    hide(receiverResult);
    hide(sendFileBtn);
    hide(transferControls);

    remoteSdp.value = '';
    receiverSdp.value = '';
    progressBar.style.width = '0%';
    setReceiverProgressText('0 / 0 bytes (0%)');

    recvChunks = [];
    recvBytes = 0;
    expectedBytes = 0;
    sendingPaused = false;
    sendingCancelled = false;
    pauseResumeBtn.textContent = 'Pause';
    setTransferStatus('No transfer');
}

function applyMode() {
    resetUiState();

    if (mode === 'send') {
        show(senderControls);
        if (selectedFile) show(localSdpWrap);
    } else {
        hide(senderControls);
        pasteLabel.textContent = 'Paste sender SDP here';
        remoteSdp.placeholder = 'Paste sender SDP here and click Confirm';
        show(pasteWrap);
    }
}

function waitForIceGatheringComplete(pc) {
    return new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') {
            resolve();
            return;
        }

        function checkState() {
            if (pc.iceGatheringState === 'complete') {
                pc.removeEventListener('icegatheringstatechange', checkState);
                resolve();
            }
        }

        pc.addEventListener('icegatheringstatechange', checkState);
    });
}

async function ensureSenderKeyPair() {
    try {
        if (FileTransferUtils.loadKeyPairFromStorage) {
            const stored = await FileTransferUtils.loadKeyPairFromStorage();
            if (stored) {
                senderKeyPair = stored;
                return;
            }
        }
    } catch (err) {
        console.warn('Failed to load stored keypair', err);
    }

    const kp = await FileTransferUtils.generateRsaKeyPair();

    try {
        if (FileTransferUtils.saveKeyPairPemToStorage) {
            FileTransferUtils.saveKeyPairPemToStorage(kp.publicKeyPem, kp.privateKeyPem);
        }
    } catch (err) {
        console.warn('Failed to save keypair', err);
    }

    senderKeyPair = kp;
}

async function setupSenderPeerAndOffer() {
    await ensureSenderKeyPair();

    closePeerConnection(senderPc);
    senderPc = new RTCPeerConnection(pcConfig);

    senderPc.onconnectionstatechange = () => {
        console.log('Sender connection state', senderPc.connectionState);
    };

    senderDataChannel = senderPc.createDataChannel('filetransfer');
    senderDataChannel.binaryType = 'arraybuffer';

    senderDataChannel.onopen = () => {
        setTransferStatus('Data channel open');
    };

    senderDataChannel.onclose = () => {
        setTransferStatus('Data channel closed');
    };

    const offer = await senderPc.createOffer();
    await senderPc.setLocalDescription(offer);
    await waitForIceGatheringComplete(senderPc);

    const meta = await FileTransferUtils.makeFileMetadata(selectedFile);
    const payload = {
        filename: meta.name,
        checksum: meta.hashSha256,
        filesize: meta.size,
        pub_key: senderKeyPair.publicKeyPem,
        sdp: senderPc.localDescription.sdp,
        type: senderPc.localDescription.type,
    };

    localSdp.value = await FileTransferUtils.encodeSdp(payload);
    show(localSdpWrap);
}

function recordSendSample(bytesSent) {
    const now = Date.now();
    recentSamples.push([now, bytesSent]);
    const cutoff = now - 10000;
    recentSamples = recentSamples.filter(sample => sample[0] >= cutoff);
}

function computeEta(totalBytes, bytesSentSoFar) {
    if (recentSamples.length < 2) return null;

    const first = recentSamples[0];
    const last = recentSamples[recentSamples.length - 1];
    const dt = (last[0] - first[0]) / 1000;
    const db = last[1] - first[1];

    if (dt <= 0 || db <= 0) return null;

    const speed = db / dt;
    return Math.max(0, totalBytes - bytesSentSoFar) / speed;
}

function formatEta(seconds) {
    if (seconds == null || Number.isNaN(seconds)) return '';
    const s = Math.round(seconds);
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;

    if (hh > 0) return `${hh}h ${mm}m`;
    if (mm > 0) return `${mm}m ${ss}s`;
    return `${ss}s`;
}

async function sendSelectedFile() {
    if (!senderDataChannel || senderDataChannel.readyState !== 'open') {
        alert('Data channel not open yet.');
        return;
    }

    if (!senderAesKey || !selectedFile) {
        alert('Missing AES key or file.');
        return;
    }

    sendingPaused = false;
    sendingCancelled = false;
    pauseResumeBtn.textContent = 'Pause';
    setTransferStatus('Sending...');
    recentSamples = [];
    show(transferControls);

    const chunkSize = 64 * 1024;
    let sentBytes = 0;

    for await (const chunk of FileTransferUtils.chunkFile(selectedFile, chunkSize)) {
        while (sendingPaused && !sendingCancelled) {
            await wait(200);
        }

        if (sendingCancelled) break;

        while (senderDataChannel.bufferedAmount > 64 * 1024 && !sendingCancelled) {
            await wait(100);
        }

        if (sendingCancelled) break;

        try {
            const encrypted = await FileTransferUtils.encryptChunkWithAesGcm(chunk.arrayBuffer, senderAesKey);
            senderDataChannel.send(encrypted.buffer);
            sentBytes += chunk.size;
            recordSendSample(sentBytes);

            const pct = Math.min(100, Math.round((sentBytes / selectedFile.size) * 100));
            const eta = computeEta(selectedFile.size, sentBytes);
            const etaText = eta != null ? ` · ETA: ${formatEta(eta)}` : '';

            progressBar.style.width = pct + '%';
            setReceiverProgressText(`${sentBytes} / ${selectedFile.size} bytes (${pct}%)${etaText}`);
            setTransferStatus(`Sending: ${pct}%${etaText}`);
        } catch (err) {
            console.error('Error during send', err);
            alert('Error during send: ' + err.message);
            break;
        }
    }

    if (sendingCancelled) {
        setTransferStatus('Cancelled');
        closePeerConnection(senderPc);
        return;
    }

    try {
        senderDataChannel.close();
    } catch {
        // ignore
    }

    progressBar.style.width = '100%';
    setReceiverProgressText(`${selectedFile.size} / ${selectedFile.size} bytes (100%)`);
    setTransferStatus('Completed');
}

function setupReceiverDataChannelHandlers(channel) {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
        console.log('Receiver datachannel open');
    };

    channel.onclose = async () => {
        console.log('Receiver datachannel closed');
        await finalizeReceivedFile();
    };

    channel.onmessage = async (ev) => {
        try {
            let arr;

            if (ev.data instanceof ArrayBuffer) {
                arr = new Uint8Array(ev.data);
            } else if (ev.data instanceof Blob) {
                arr = new Uint8Array(await ev.data.arrayBuffer());
            } else if (typeof ev.data === 'string') {
                arr = new Uint8Array(FileTransferUtils.base64ToArrayBuffer(ev.data));
            } else {
                return;
            }

            const plainBuffer = await FileTransferUtils.decryptChunkWithAesGcm(arr, receiverAesKey);
            recvChunks.push(new Uint8Array(plainBuffer));
            recvBytes += plainBuffer.byteLength;

            const pct = expectedBytes
                ? Math.min(100, Math.round((recvBytes / expectedBytes) * 100))
                : 0;

            progressBar.style.width = pct + '%';
            setReceiverProgressText(`${recvBytes} / ${expectedBytes} bytes (${pct}%)`);
        } catch (err) {
            console.error('Receive/decrypt error', err);
        }
    };
}

async function handleReceiverApply(encodedSenderPayload) {
    let remoteDesc;

    try {
        remoteDesc = await FileTransferUtils.decodeSdp(encodedSenderPayload);
    } catch (err) {
        alert('Failed to decode sender SDP payload.');
        console.error(err);
        return;
    }

    console.log('Decoded sender payload:', remoteDesc);

    if (!remoteDesc?.sdp || !remoteDesc?.type) {
        alert('Payload missing sdp or type.');
        return;
    }

    if (remoteDesc.type.toLowerCase() !== 'offer') {
        alert(`Expected offer, got ${remoteDesc.type}`);
        return;
    }

    closePeerConnection(receiverPc);
    receiverPc = null;

    recvFilename = remoteDesc.filename || 'received.dat';
    recvChecksum = remoteDesc.checksum || null;
    expectedBytes = Number(remoteDesc.filesize) || 0;
    recvChunks = [];
    recvBytes = 0;
    progressBar.style.width = '0%';
    setReceiverProgressText(`0 / ${expectedBytes} bytes (0%)`);

    receiverPc = new RTCPeerConnection(pcConfig);

    receiverPc.onconnectionstatechange = () => {
        console.log('Receiver connection state', receiverPc.connectionState);
    };

    receiverPc.ondatachannel = (evt) => {
        setupReceiverDataChannelHandlers(evt.channel);
    };

    try {
        await receiverPc.setRemoteDescription(new RTCSessionDescription({
            type: remoteDesc.type,
            sdp: remoteDesc.sdp
        }));
        console.log('setRemoteDescription OK; signalingState:', receiverPc.signalingState);
    } catch (err) {
        console.error(err);
        alert('Failed to set remote description: ' + err.message);
        return;
    }

    await wait(200);

    let senderPubCrypto;
    try {
        senderPubCrypto = await FileTransferUtils.importRsaPublicKeyFromPem(remoteDesc.pub_key);
    } catch (err) {
        console.error(err);
        alert('Failed to import sender public key.');
        return;
    }

    try {
        receiverAesKey = await FileTransferUtils.generateAesGcmKey();
        const rawSym = await FileTransferUtils.exportRawKey(receiverAesKey);
        const wrapped = await FileTransferUtils.wrapSymmetricKeyWithRsa(rawSym, senderPubCrypto);

        try {
            const answer = await receiverPc.createAnswer();
            await receiverPc.setLocalDescription(answer);
        } catch (firstErr) {
            console.warn('First createAnswer failed, trying fallback', firstErr);

            const fallbackChannel = receiverPc.createDataChannel('filetransfer-fallback');
            setupReceiverDataChannelHandlers(fallbackChannel);

            await wait(250);

            const answer = await receiverPc.createAnswer();
            await receiverPc.setLocalDescription(answer);
        }

        await waitForIceGatheringComplete(receiverPc);

        const payload = {
            sym_key: wrapped,
            sdp: receiverPc.localDescription.sdp,
            type: receiverPc.localDescription.type,
        };

        receiverSdp.value = await FileTransferUtils.encodeSdp(payload);
        show(receiverResult);
        hide(pasteWrap);
    } catch (err) {
        console.error('Receiver setup failed', err);
        alert('Receiver setup failed: ' + err.message);
    }
}

async function finalizeReceivedFile() {
    if (!recvChunks.length) return;

    const blob = new Blob(recvChunks);

    try {
        const receivedFile = new File([blob], recvFilename, { type: '' });
        const actualChecksum = await FileTransferUtils.computeSha256Hex(receivedFile);

        if (actualChecksum === recvChecksum) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = recvFilename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            setReceiverProgressText(`Verified and downloaded: ${recvFilename}`);
        } else {
            setReceiverProgressText(`Checksum mismatch. Expected: ${recvChecksum}, Actual: ${actualChecksum}`);
        }
    } catch (err) {
        console.error(err);
        setReceiverProgressText('Failed to finalize received file.');
    } finally {
        recvChunks = [];
        recvBytes = 0;
        progressBar.style.width = '0%';
    }
}

function showAbout() {
    aboutOverlay.classList.remove('hidden');
    aboutOverlay.setAttribute('tabindex', '-1');
    aboutOverlay.focus();
    document.body.style.overflow = 'hidden';
}

function hideAbout() {
    aboutOverlay.classList.add('hidden');
    document.body.style.overflow = '';
    aboutBtn.focus();
}

pillBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        pillBtns.forEach(b => b.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
        mode = btn.dataset.mode;
        updatePill();
        applyMode();
    });
});

window.addEventListener('load', () => {
    updatePill();
    applyMode();
});

window.addEventListener('resize', updatePill);

browseBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
    const f = e.target.files[0];

    if (!f) {
        selectedFile = null;
        fileNameField.value = '';
        fileInfo.textContent = 'Info about the file: size, name, type, hash';
        hide(localSdpWrap);
        return;
    }

    selectedFile = f;
    fileNameField.value = f.name;

    const infoBasic = `Name: ${f.name} · Size: ${Math.round(f.size / 1024)} KB · Type: ${f.type || 'unknown'}`;
    fileInfo.textContent = infoBasic + ' · calculating hash…';

    try {
        const hashHex = await FileTransferUtils.computeSha256Hex(f);
        fileInfo.textContent = `${infoBasic} · Hash (SHA-256): ${hashHex}`;
    } catch {
        fileInfo.textContent = `${infoBasic} · Hash: (failed to compute)`;
    }

    await setupSenderPeerAndOffer();
});

regenBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    await setupSenderPeerAndOffer();
});

copyLocalBtn.addEventListener('click', async () => {
    if (!localSdp.value) return;

    try {
        await navigator.clipboard.writeText(localSdp.value);
    } catch {
        // ignore
    }

    hide(senderControls);
    hide(localSdpWrap);
    pasteLabel.textContent = 'Paste receiver SDP here';
    remoteSdp.placeholder = 'Paste receiver SDP here and click Confirm';
    show(pasteWrap);
    remoteSdp.focus();
});

applyRemoteBtn.addEventListener('click', async () => {
    const txt = remoteSdp.value.trim();

    if (!txt) {
        alert('Please paste the remote SDP first.');
        return;
    }

    if (mode === 'send') {
        let remoteDesc;

        try {
            remoteDesc = await FileTransferUtils.decodeSdp(txt);
        } catch {
            alert('Failed to decode remote SDP.');
            return;
        }

        if (!remoteDesc.sym_key || !remoteDesc.sdp || !remoteDesc.type) {
            alert('Remote payload missing symmetric key or SDP.');
            return;
        }

        await senderPc.setRemoteDescription(new RTCSessionDescription({
            type: remoteDesc.type,
            sdp: remoteDesc.sdp
        }));

        try {
            senderAesKey = await FileTransferUtils.unwrapSymmetricKeyWithRsa(
                remoteDesc.sym_key,
                senderKeyPair.privateKey
            );
        } catch (err) {
            console.error(err);
            alert('Failed to unwrap symmetric key.');
            return;
        }

        show(sendFileBtn);
        show(transferControls);
        setTransferStatus('Ready to send');
    } else {
        await handleReceiverApply(txt);
    }
});

sendFileBtn.addEventListener('click', sendSelectedFile);

pauseResumeBtn.addEventListener('click', () => {
    sendingPaused = !sendingPaused;
    pauseResumeBtn.textContent = sendingPaused ? 'Resume' : 'Pause';
    setTransferStatus(sendingPaused ? 'Paused' : 'Sending...');
});

cancelBtn.addEventListener('click', () => {
    sendingCancelled = true;
    setTransferStatus('Cancelled');

    if (senderDataChannel && senderDataChannel.readyState === 'open') {
        try {
            senderDataChannel.close();
        } catch {
            // ignore
        }
    }
});

copyReceiverBtn.addEventListener('click', async () => {
    if (!receiverSdp.value) return;

    try {
        await navigator.clipboard.writeText(receiverSdp.value);
    } catch {
        alert('Copy failed. You can copy manually.');
    }
});

aboutBtn.addEventListener('click', showAbout);
aboutClose.addEventListener('click', hideAbout);

aboutOverlay.addEventListener('click', (e) => {
    if (e.target === aboutOverlay) hideAbout();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !aboutOverlay.classList.contains('hidden')) {
        hideAbout();
    }
});