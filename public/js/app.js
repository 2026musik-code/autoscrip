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

socket.on('log', (msg) => {
    logBox.innerHTML += msg;
    logBox.scrollTop = logBox.scrollHeight;
});

socket.on('status', (msg) => {
    if (msg.status === 'success') {
        const { domain, uuid, adminUrl } = msg.data;
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
            <div style="background: #222; padding: 30px; border-radius: 10px; border: 2px solid #0f0; max-width: 500px; text-align: center; color: white;">
                <h2 style="color: #0f0;">INSTALLATION SUCCESSFUL!</h2>
                <p><strong>Domain:</strong> ${domain}</p>
                <p><strong>Admin UUID (Password):</strong> <br><code style="background:#444; padding:5px; display:block; margin:10px 0;">${uuid}</code></p>
                <a href="${adminUrl}" target="_blank" style="display:inline-block; background:#ffd700; color:black; padding:10px 20px; text-decoration:none; font-weight:bold; border-radius:5px; margin-top:10px;">OPEN ADMIN LOGIN</a>
                <br><br>
                <button onclick="this.closest('div').parentElement.remove()" style="background:#555; color:white; border:none; padding:5px 10px; cursor:pointer;">Close</button>
            </div>
        `;
        document.body.appendChild(successModal);

    } else if (msg.status === 'error') {
        alert('Installation Failed! Check logs.');
    }
});
