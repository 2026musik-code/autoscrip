const socket = io();
const form = document.getElementById('installForm');
const logBox = document.getElementById('logBox');

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const ip = document.getElementById('ip').value;
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const authType = document.getElementById('authType').value;
    const privateKey = document.getElementById('privateKey').value;
    const domain = document.getElementById('domain').value;
    const licenseToken = document.getElementById('licenseToken').value;
    const os = document.getElementById('os').value;

    logBox.style.display = 'block';
    logBox.innerHTML = 'Connecting to server...\n';

    try {
        const response = await fetch('/api/install', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-socket-id': socket.id
            },
            body: JSON.stringify({ ip, username, password, privateKey, authType, domain, os, licenseToken })
        });

        const result = await response.json();
        console.log(result);

    } catch (err) {
        logBox.innerHTML += `\nError: ${err.message}`;
    }
});

function formatLog(text) {
    if (!text) return '';

    // 1. Escape HTML to prevent injection
    let safeText = text.replace(/&/g, "&amp;")
                       .replace(/</g, "&lt;")
                       .replace(/>/g, "&gt;");

    // 2. Parse ANSI Colors
    // Green
    safeText = safeText.replace(/\x1b\[(0;)?32m/g, '<span style="color:#00ff00;">');
    // Red
    safeText = safeText.replace(/\x1b\[(0;)?31m/g, '<span style="color:#ff4444;">');
    // Yellow
    safeText = safeText.replace(/\x1b\[(0;)?33m/g, '<span style="color:#ffff00;">');
    // Blue
    safeText = safeText.replace(/\x1b\[(0;)?34m/g, '<span style="color:#4444ff;">');
    // Cyan
    safeText = safeText.replace(/\x1b\[(0;)?36m/g, '<span style="color:#00ffff;">');
    // Bold
    safeText = safeText.replace(/\x1b\[1m/g, '<span style="font-weight:bold;">');

    // Reset (Close span) - We assume one level of nesting or just close the last one.
    // HTML is lenient, but correct way is to close the span.
    // Since we don't track state, we just replace Reset with </span>.
    // If there was no open span, </span> is harmlessly ignored by browsers usually.
    safeText = safeText.replace(/\x1b\[0;0m/g, '</span>');
    safeText = safeText.replace(/\x1b\[0m/g, '</span>');

    // Remove remaining unhandled ANSI codes
    safeText = safeText.replace(/\x1b\[[0-9;]*m/g, '');

    return safeText;
}

socket.on('log', (msg) => {
    logBox.innerHTML += formatLog(msg);
    logBox.scrollTop = logBox.scrollHeight;
});

socket.on('status', (msg) => {
    if (msg.status === 'success') {
        const { domain, uuid, adminUrl } = msg.data;
        const publicUrl = `https://${domain}`;

        const successModal = document.createElement('div');
        successModal.style.position = 'fixed';
        successModal.style.top = '0';
        successModal.style.left = '0';
        successModal.style.width = '100%';
        successModal.style.height = '100%';
        successModal.style.backgroundColor = 'rgba(0,0,0,0.9)';
        successModal.style.display = 'flex';
        successModal.style.justifyContent = 'center';
        successModal.style.alignItems = 'center';
        successModal.style.zIndex = '1000';

        successModal.innerHTML = `
            <div style="background: #1e1e1e; padding: 0; border-radius: 12px; border: 1px solid #333; width: 90%; max-width: 500px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5); color: #e0e0e0; font-family: 'Segoe UI', sans-serif;">
                <div style="background: #28a745; color: white; padding: 20px; text-align: center;">
                    <h2 style="margin:0; font-size: 1.5rem;">INSTALLATION SUCCESSFUL</h2>
                    <p style="margin:5px 0 0 0; opacity: 0.9;">VPS is ready to use</p>
                </div>

                <div style="padding: 25px;">
                    <div style="margin-bottom: 20px;">
                        <label style="color:#888; font-size:0.85rem; display:block; margin-bottom:5px;">DOMAIN</label>
                        <div style="background:#2c2c2c; padding:10px; border-radius:5px; font-weight:bold; color:#fff;">${domain}</div>
                    </div>

                    <div style="display:flex; gap:10px; margin-bottom:20px;">
                        <div style="flex:1;">
                            <label style="color:#888; font-size:0.85rem; display:block; margin-bottom:5px;">PUBLIC PANEL</label>
                            <a href="${publicUrl}" target="_blank" style="display:block; background:#007bff; color:white; text-decoration:none; padding:10px; border-radius:5px; text-align:center; font-weight:bold;">
                                Open Dashboard
                            </a>
                        </div>
                        <div style="flex:1;">
                            <label style="color:#888; font-size:0.85rem; display:block; margin-bottom:5px;">ADMIN PANEL</label>
                            <a href="${adminUrl}" target="_blank" style="display:block; background:#ffd700; color:black; text-decoration:none; padding:10px; border-radius:5px; text-align:center; font-weight:bold;">
                                Admin Login
                            </a>
                        </div>
                    </div>

                    <div style="margin-bottom: 25px;">
                        <label style="color:#888; font-size:0.85rem; display:block; margin-bottom:5px;">ADMIN UUID (PASSWORD)</label>
                        <div style="display:flex; background:#2c2c2c; border-radius:5px; overflow:hidden; border:1px solid #444;">
                            <input type="text" value="${uuid}" readonly style="flex:1; background:none; border:none; color:#0f0; padding:10px; font-family:monospace; font-size:1.1rem; outline:none;" id="uuidField">
                            <button onclick="copyUuid()" style="background:#444; color:white; border:none; padding:0 15px; cursor:pointer; font-weight:bold; margin:0;">COPY</button>
                        </div>
                    </div>

                    <button onclick="this.closest('div').parentElement.remove()" style="width:100%; background:transparent; border:1px solid #555; color:#aaa; padding:12px; border-radius:5px; cursor:pointer;">Close Window</button>
                </div>
            </div>
        `;
        document.body.appendChild(successModal);

        // Add Helper Function specifically for this modal context if needed
        // But we can define it globally or attach to window.
        window.copyUuid = function() {
            const copyText = document.getElementById("uuidField");
            copyText.select();
            copyText.setSelectionRange(0, 99999);
            navigator.clipboard.writeText(copyText.value).then(() => {
                alert("UUID Copied to Clipboard!");
            });
        };

    } else if (msg.status === 'error') {
        alert('Installation Failed! Check logs.');
    }
});
