const loginForm = document.getElementById('loginForm');
const togglePills = document.querySelectorAll('.pill-option');
const generateButton = document.getElementById('generateBtn');
const statusText = document.getElementById('statusText');
const outputBox = document.getElementById('generated-key');
const copyBtn = document.getElementById('copyBtn');
const clearBtn = document.getElementById('clearBtn');

const aboutBtn = document.getElementById('aboutBtn');
const aboutOverlay = document.getElementById('aboutOverlay');
const aboutClose = document.getElementById('aboutClose');

const installBtn = document.getElementById('installBtn');

let selectedKeyLength = 128;
let deferredPrompt = null;

function setStatus(message = '', type = '') {
    statusText.textContent = message;
    statusText.className = 'status-text';
    if (type) statusText.classList.add(type);
}

togglePills.forEach((pill) => {
    pill.addEventListener('click', function () {
        togglePills.forEach((p) => {
            p.classList.remove('selected');
            p.setAttribute('aria-pressed', 'false');
        });

        this.classList.add('selected');
        this.setAttribute('aria-pressed', 'true');
        selectedKeyLength = parseInt(this.dataset.keyLength, 10);
    });
});

loginForm.addEventListener('submit', async function (event) {
    event.preventDefault();

    const secretPasswordField = document.getElementById('secret-password');
    const sitePasswordField = document.getElementById('site-password');

    const secretPassword = secretPasswordField.value;
    const sitePassword = sitePasswordField.value;

    setStatus('');

    if (secretPassword.length < 8) {
        secretPasswordField.value = '';
        sitePasswordField.value = '';
        outputBox.value = '';
        setStatus('Secret password must be at least 8 characters.', 'error');

        secretPasswordField.classList.add('shake');
        setTimeout(() => {
            secretPasswordField.classList.remove('shake');
        }, 500);

        return;
    }

    try {
        const derivedKey = await deriveKey(secretPassword, sitePassword, selectedKeyLength);
        const humanReadableKey = bufferToCustomCharset(derivedKey);

        outputBox.value = humanReadableKey;

        secretPasswordField.value = '';
        sitePasswordField.value = '';

        generateButton.classList.add('success');
        generateButton.innerHTML = `<span>&#10004;</span>`;
        setStatus('Key generated.', 'success');

        setTimeout(() => {
            generateButton.textContent = 'Generate';
            generateButton.classList.remove('success');
        }, 2000);
    } catch (err) {
        console.error('Error generating the key:', err);
        setStatus('Failed to generate the key.', 'error');
    }
});

copyBtn.addEventListener('click', async () => {
    if (!outputBox.value) {
        setStatus('Nothing to copy.', 'error');
        return;
    }

    try {
        await navigator.clipboard.writeText(outputBox.value);
        setStatus('Key copied to clipboard.', 'success');
    } catch (err) {
        console.error('Copy failed:', err);
        setStatus('Failed to copy key.', 'error');
    }
});

clearBtn.addEventListener('click', () => {
    outputBox.value = '';
    setStatus('');
});

async function deriveKey(password, salt, keyLength) {
    const passwordBuffer = new TextEncoder().encode(password);
    const saltBuffer = new TextEncoder().encode(salt);

    const baseKey = await window.crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );

    return window.crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            hash: 'SHA-256',
            salt: saltBuffer,
            iterations: 100000
        },
        baseKey,
        keyLength
    );
}

function bufferToCustomCharset(buffer) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    const byteArray = new Uint8Array(buffer);
    const charsetLength = charset.length;

    return Array.from(byteArray)
        .map(byte => charset[byte % charsetLength])
        .join('');
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

/* ---------- Install UX ---------- */

// Some platforms expose navigator.standalone or media query; use a simple check to hide install button if already installed
function isRunningStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// Handle beforeinstallprompt (Chrome/Edge)
window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (installBtn && !isRunningStandalone()) {
        installBtn.classList.remove('hidden');
    }
});

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;

        try {
            deferredPrompt.prompt();
            const choiceResult = await deferredPrompt.userChoice;

            if (choiceResult.outcome === 'accepted') {
                setStatus('Install prompt shown.', 'success');
            }

            deferredPrompt = null;
            installBtn.classList.add('hidden');
        } catch (err) {
            console.error('Install prompt failed', err);
            setStatus('Install could not be started.', 'error');
        }
    });
}

// Hide install button if already installed
window.addEventListener('appinstalled', () => {
    setStatus('SaltBloc installed.', 'success');
    if (installBtn) installBtn.classList.add('hidden');
    deferredPrompt = null;
});

// On load, hide install button if already standalone
window.addEventListener('load', () => {
    if (installBtn) {
        if (isRunningStandalone()) installBtn.classList.add('hidden');
    }
});

/* ---------- Service Worker ---------- */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(() => {
                console.log('Service worker registered');
            })
            .catch((err) => {
                console.error('Service worker registration failed:', err);
            });
    });
}