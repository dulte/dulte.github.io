// utils.js
// Browser-side utilities for file transfer: hashing (streaming fallback),
// chunking, SDP encode/decode, RSA/AES key handling, encrypt/decrypt chunk helpers,
// and persistent key storage.
//
// Attaches to window.FileTransferUtils

(function (global) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const FileTransferUtils = {};

    /* ---------- Basic helpers ---------- */

    FileTransferUtils.bytesToHex = function (bytes) {
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    };

    FileTransferUtils.hexToBytes = function (hex) {
        if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
        const out = new Uint8Array(hex.length / 2);
        for (let i = 0; i < out.length; i++) {
            out[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return out;
    };

    FileTransferUtils.arrayBufferToBase64 = function (arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);
        const chunkSize = 0x8000;
        let binary = '';

        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }

        return btoa(binary);
    };

    FileTransferUtils.base64ToArrayBuffer = function (b64) {
        const binary = atob(b64);
        const len = binary.length;
        const bytes = new Uint8Array(len);

        for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        return bytes.buffer;
    };

    /* ---------- SDP encode / decode ---------- */

    async function compressIfAvailable(uint8array) {
        if (typeof CompressionStream === 'function') {
            const rs = new ReadableStream({
                start(controller) {
                    controller.enqueue(uint8array);
                    controller.close();
                }
            });
            const cs = rs.pipeThrough(new CompressionStream('deflate'));
            const compressed = await new Response(cs).arrayBuffer();
            return new Uint8Array(compressed);
        }

        return uint8array;
    }

    async function decompressIfAvailable(uint8array) {
        if (typeof DecompressionStream === 'function') {
            const rs = new ReadableStream({
                start(controller) {
                    controller.enqueue(uint8array);
                    controller.close();
                }
            });
            const ds = rs.pipeThrough(new DecompressionStream('deflate'));
            const decompressed = await new Response(ds).arrayBuffer();
            return new Uint8Array(decompressed);
        }

        return uint8array;
    }

    FileTransferUtils.encodeSdp = async function (sdpObject) {
        const json = JSON.stringify(sdpObject);
        const raw = encoder.encode(json);
        const compressed = await compressIfAvailable(raw);
        return FileTransferUtils.arrayBufferToBase64(compressed.buffer);
    };

    FileTransferUtils.decodeSdp = async function (encoded) {
        const ab = FileTransferUtils.base64ToArrayBuffer(encoded);
        const uint8 = new Uint8Array(ab);
        const decompressed = await decompressIfAvailable(uint8);
        const jsonString = decoder.decode(decompressed);
        return JSON.parse(jsonString);
    };

    /* ---------- Incremental SHA-256 fallback ---------- */

    function Sha256() {
        this._k = [
            0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
            0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
            0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
            0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
            0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
            0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
            0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
            0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
            0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
            0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
            0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
            0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
            0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
            0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
            0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
        ];
        this._h = [
            0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
            0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
        ];
        this._buf = new Uint8Array(64);
        this._bufIdx = 0;
        this._count = 0;
    }

    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    function shr(x, n) { return x >>> n; }

    Sha256.prototype._processChunk = function (chunk) {
        const w = new Uint32Array(64);
        const view = new DataView(chunk.buffer || chunk, chunk.byteOffset || 0, 64);

        for (let i = 0; i < 16; i++) {
            w[i] = view.getUint32(i * 4);
        }

        for (let i = 16; i < 64; i++) {
            const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ shr(w[i - 15], 3)) >>> 0;
            const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ shr(w[i - 2], 10)) >>> 0;
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }

        let a = this._h[0];
        let b = this._h[1];
        let c = this._h[2];
        let d = this._h[3];
        let e = this._h[4];
        let f = this._h[5];
        let g = this._h[6];
        let h = this._h[7];

        for (let i = 0; i < 64; i++) {
            const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
            const ch = ((e & f) ^ (~e & g)) >>> 0;
            const temp1 = (h + S1 + ch + this._k[i] + w[i]) >>> 0;
            const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
            const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
            const temp2 = (S0 + maj) >>> 0;

            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        this._h[0] = (this._h[0] + a) >>> 0;
        this._h[1] = (this._h[1] + b) >>> 0;
        this._h[2] = (this._h[2] + c) >>> 0;
        this._h[3] = (this._h[3] + d) >>> 0;
        this._h[4] = (this._h[4] + e) >>> 0;
        this._h[5] = (this._h[5] + f) >>> 0;
        this._h[6] = (this._h[6] + g) >>> 0;
        this._h[7] = (this._h[7] + h) >>> 0;
    };

    Sha256.prototype.update = function (data) {
        let pos = 0;
        const len = data.length;
        this._count += len;

        while (pos < len) {
            const need = 64 - this._bufIdx;
            const take = Math.min(need, len - pos);
            this._buf.set(data.subarray(pos, pos + take), this._bufIdx);
            this._bufIdx += take;
            pos += take;

            if (this._bufIdx === 64) {
                this._processChunk(this._buf);
                this._bufIdx = 0;
            }
        }
    };

    Sha256.prototype.digest = function () {
        const bitLen = this._count * 8;

        this._buf[this._bufIdx++] = 0x80;

        if (this._bufIdx > 56) {
            while (this._bufIdx < 64) this._buf[this._bufIdx++] = 0x00;
            this._processChunk(this._buf);
            this._bufIdx = 0;
        }

        while (this._bufIdx < 56) this._buf[this._bufIdx++] = 0x00;

        const view = new DataView(this._buf.buffer);
        view.setUint32(56, Math.floor(bitLen / 0x100000000));
        view.setUint32(60, bitLen & 0xffffffff);

        this._processChunk(this._buf);

        const out = new Uint8Array(32);
        const outView = new DataView(out.buffer);
        for (let i = 0; i < 8; i++) {
            outView.setUint32(i * 4, this._h[i]);
        }

        return out;
    };

    /* ---------- Hashing ---------- */

    FileTransferUtils.computeSha256Hex = async function (file) {
        try {
            if (typeof DigestStream === 'function') {
                const ds = new DigestStream('SHA-256');
                await file.stream().pipeTo(ds.writable);
                const digestBuffer = await ds.digest();
                return FileTransferUtils.bytesToHex(new Uint8Array(digestBuffer));
            }
        } catch {
            // fallback below
        }

        const reader = file.stream().getReader();
        const sha = new Sha256();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sha.update(new Uint8Array(value));
        }

        return FileTransferUtils.bytesToHex(sha.digest());
    };

    FileTransferUtils.getChecksumAndSize = async function (file) {
        const size = file.size;
        const checksum = await FileTransferUtils.computeSha256Hex(file);
        return { checksum, size };
    };

    /* ---------- File chunking ---------- */

    FileTransferUtils.chunkFile = async function* (file, chunkSize = 64 * 1024) {
        const total = file.size;
        let offset = 0;
        let index = 0;

        while (offset < total) {
            const end = Math.min(offset + chunkSize, total);
            const blob = file.slice(offset, end);
            const arrayBuffer = await blob.arrayBuffer();

            yield {
                index: index++,
                offset,
                end,
                size: end - offset,
                blob,
                arrayBuffer
            };

            offset = end;
        }
    };

    /* ---------- PEM helpers ---------- */

    function arrayBufferToPem(buffer, label) {
        const b64 = FileTransferUtils.arrayBufferToBase64(buffer);
        const lines = b64.match(/.{1,64}/g) || [];
        return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
    }

    function pemToArrayBuffer(pem) {
        const b64 = pem
            .replace(/-----BEGIN [^-]+-----/, '')
            .replace(/-----END [^-]+-----/, '')
            .replace(/\s+/g, '');
        return FileTransferUtils.base64ToArrayBuffer(b64);
    }

    /* ---------- RSA key generation / import / export ---------- */

    FileTransferUtils.generateRsaKeyPair = async function () {
        const kp = await crypto.subtle.generateKey(
            {
                name: 'RSA-OAEP',
                modulusLength: 2048,
                publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
                hash: 'SHA-256'
            },
            true,
            ['encrypt', 'decrypt']
        );

        const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
        const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey);

        return {
            publicKey: kp.publicKey,
            privateKey: kp.privateKey,
            publicKeyPem: arrayBufferToPem(spki, 'PUBLIC KEY'),
            privateKeyPem: arrayBufferToPem(pkcs8, 'PRIVATE KEY')
        };
    };

    FileTransferUtils.importRsaPublicKeyFromPem = async function (pem) {
        return crypto.subtle.importKey(
            'spki',
            pemToArrayBuffer(pem),
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            true,
            ['encrypt']
        );
    };

    FileTransferUtils.importRsaPrivateKeyFromPem = async function (pem) {
        return crypto.subtle.importKey(
            'pkcs8',
            pemToArrayBuffer(pem),
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            true,
            ['decrypt']
        );
    };

    FileTransferUtils.exportPublicKeyPem = async function (cryptoPublicKey) {
        const spki = await crypto.subtle.exportKey('spki', cryptoPublicKey);
        return arrayBufferToPem(spki, 'PUBLIC KEY');
    };

    FileTransferUtils.exportPrivateKeyPem = async function (cryptoPrivateKey) {
        const pkcs8 = await crypto.subtle.exportKey('pkcs8', cryptoPrivateKey);
        return arrayBufferToPem(pkcs8, 'PRIVATE KEY');
    };

    /* ---------- Persistent key storage ---------- */

    FileTransferUtils.saveKeyPairPemToStorage = function (pubPem, privPem) {
        try {
            localStorage.setItem('ft_public_pem', pubPem);
            localStorage.setItem('ft_private_pem', privPem);
            return true;
        } catch {
            return false;
        }
    };

    FileTransferUtils.loadKeyPairFromStorage = async function () {
        try {
            const pubPem = localStorage.getItem('ft_public_pem');
            const privPem = localStorage.getItem('ft_private_pem');

            if (!pubPem || !privPem) return null;

            const publicKey = await FileTransferUtils.importRsaPublicKeyFromPem(pubPem);
            const privateKey = await FileTransferUtils.importRsaPrivateKeyFromPem(privPem);

            return {
                publicKey,
                privateKey,
                publicKeyPem: pubPem,
                privateKeyPem: privPem
            };
        } catch {
            return null;
        }
    };

    FileTransferUtils.deleteKeyPairFromStorage = function () {
        localStorage.removeItem('ft_public_pem');
        localStorage.removeItem('ft_private_pem');
    };

    /* ---------- AES-GCM helpers ---------- */

    FileTransferUtils.generateAesGcmKey = async function () {
        return crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    };

    FileTransferUtils.exportRawKey = async function (cryptoKey) {
        const raw = await crypto.subtle.exportKey('raw', cryptoKey);
        return new Uint8Array(raw);
    };

    FileTransferUtils.importRawAesKey = async function (rawBytes) {
        return crypto.subtle.importKey(
            'raw',
            rawBytes,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    };

    FileTransferUtils.wrapSymmetricKeyWithRsa = async function (rawSymKeyUint8, rsaPublicKeyCrypto) {
        const ab = rawSymKeyUint8 instanceof ArrayBuffer
            ? rawSymKeyUint8
            : rawSymKeyUint8.buffer || rawSymKeyUint8;

        const enc = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsaPublicKeyCrypto, ab);
        return FileTransferUtils.arrayBufferToBase64(enc);
    };

    FileTransferUtils.unwrapSymmetricKeyWithRsa = async function (wrappedBase64, rsaPrivateKeyCrypto) {
        const ab = FileTransferUtils.base64ToArrayBuffer(wrappedBase64);
        const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, rsaPrivateKeyCrypto, ab);
        return FileTransferUtils.importRawAesKey(new Uint8Array(raw));
    };

    FileTransferUtils.encryptChunkWithAesGcm = async function (arrayBuffer, aesKeyCrypto) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKeyCrypto, arrayBuffer);
        const cipherBytes = new Uint8Array(cipher);

        const out = new Uint8Array(iv.length + cipherBytes.length);
        out.set(iv, 0);
        out.set(cipherBytes, iv.length);

        return out;
    };

    FileTransferUtils.decryptChunkWithAesGcm = async function (ivCipherUint8, aesKeyCrypto) {
        const iv = ivCipherUint8.slice(0, 12);
        const cipher = ivCipherUint8.slice(12);
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKeyCrypto, cipher);
    };

    /* ---------- File metadata ---------- */

    FileTransferUtils.makeFileMetadata = async function (file, options = {}) {
        const chunkSize = options.chunkSize || 64 * 1024;
        const hash = options.hashHex || await FileTransferUtils.computeSha256Hex(file);

        return {
            name: file.name,
            size: file.size,
            type: file.type || '',
            hashSha256: hash,
            chunkSize,
            chunkCount: Math.ceil(file.size / chunkSize),
            lastModified: file.lastModified
        };
    };

    global.FileTransferUtils = FileTransferUtils;
})(window);