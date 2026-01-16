const socket = io();
const form = document.getElementById('rebuildForm');
const logBox = document.getElementById('logBox');
const osSelect = document.getElementById('targetOS');
const verSelect = document.getElementById('targetVersion');

const versions = {
    ubuntu: ['24.04', '22.04', '20.04', '18.04'],
    debian: ['12', '11', '10', '9'],
    centos: ['7', '8', '9'],
    alpine: ['3.20', '3.19', '3.18']
};

function updateVersions() {
    const os = osSelect.value;
    const vers = versions[os] || [];
    verSelect.innerHTML = '';
    vers.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.innerText = v;
        verSelect.appendChild(opt);
    });
}

// Init
updateVersions();

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!confirm('WARNING: THIS WILL WIPE ALL DATA ON THE VPS AND REINSTALL THE OS. ARE YOU SURE?')) return;

    const ip = document.getElementById('ip').value;
    const username = document.getElementById('username').value;
    const currentPassword = document.getElementById('currentPassword').value;
    const targetOS = document.getElementById('targetOS').value;
    const targetVersion = document.getElementById('targetVersion').value;
    const newPassword = document.getElementById('newPassword').value;

    logBox.style.display = 'block';
    logBox.innerHTML = 'Connecting to server to initiate rebuild...\n';

    try {
        const response = await fetch('/api/rebuild', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-socket-id': socket.id
            },
            body: JSON.stringify({ ip, username, currentPassword, targetOS, targetVersion, newPassword })
        });

        const result = await response.json();
        console.log(result);

    } catch (err) {
        logBox.innerHTML += `\nError: ${err.message}`;
    }
});

function formatLog(text) {
    if (!text) return '';

    // 1. Escape HTML
    let safeText = text.replace(/&/g, "&amp;")
                       .replace(/</g, "&lt;")
                       .replace(/>/g, "&gt;");

    // 2. Parse ANSI Colors
    safeText = safeText.replace(/\x1b\[(0;)?32m/g, '<span style="color:#00ff00;">'); // Green
    safeText = safeText.replace(/\x1b\[(0;)?31m/g, '<span style="color:#ff4444;">'); // Red
    safeText = safeText.replace(/\x1b\[(0;)?33m/g, '<span style="color:#ffff00;">'); // Yellow
    safeText = safeText.replace(/\x1b\[(0;)?34m/g, '<span style="color:#4444ff;">'); // Blue
    safeText = safeText.replace(/\x1b\[(0;)?36m/g, '<span style="color:#00ffff;">'); // Cyan
    safeText = safeText.replace(/\x1b\[1m/g, '<span style="font-weight:bold;">');     // Bold

    // Reset
    safeText = safeText.replace(/\x1b\[0;0m/g, '</span>');
    safeText = safeText.replace(/\x1b\[0m/g, '</span>');

    // Remove remaining
    safeText = safeText.replace(/\x1b\[[0-9;]*m/g, '');

    return safeText;
}

socket.on('log', (msg) => {
    logBox.innerHTML += formatLog(msg);
    logBox.scrollTop = logBox.scrollHeight;
});

socket.on('status', (msg) => {
    if (msg.status === 'rebuild_success') {
        alert('Rebuild Command Sent! VPS should be rebooting now. Wait 10-20 minutes before reconnecting.');
    } else if (msg.status === 'error') {
        alert('Rebuild Failed! Check logs.');
    }
});
