const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client } = require('ssh2');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const CryptoJS = require("crypto-js");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const DB_FILE = 'db.json';
const ADMIN_KEY = process.env.ADMIN_KEY || 'secret123';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'mySuperSecretKey123';

// Helper: Encrypt/Decrypt
function encrypt(text) {
    return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}
function decrypt(ciphertext) {
    const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
}

// Initialize DB
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ servers: [] }, null, 2));
}

function getDB() {
    return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Middleware to check Admin Key
function authMiddleware(req, res, next) {
    const key = req.headers['x-admin-key'];
    if (key === ADMIN_KEY) {
        next();
    } else {
        console.warn(`[Auth Failed] IP: ${req.ip}. Received Key: '${key}', Expected: '${ADMIN_KEY}'`);
        res.status(403).json({ error: 'Unauthorized: Invalid Admin Key' });
    }
}

// Socket.io connection
io.on('connection', (socket) => {
    console.log('A user connected');
    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// Installation Endpoint
app.post('/api/install', (req, res) => {
    const { ip, username, password, privateKey, authType, domain, os } = req.body;
    const socketId = req.headers['x-socket-id'];

    // 1. Input Validation
    if (!ip || !domain) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    if (authType === 'password' && !password) return res.status(400).json({ error: 'Password required' });
    if (authType === 'key' && !privateKey) return res.status(400).json({ error: 'Private Key required' });

    // Validate Domain format (Simple Regex to prevent injection)
    // Allowed: letters, numbers, dots, hyphens. No spaces, semi-colons, etc.
    const domainRegex = /^[a-zA-Z0-9.-]+$/;
    if (!domainRegex.test(domain)) {
        return res.status(400).json({ error: 'Invalid Domain Format. Only alphanumeric, dots, and hyphens allowed.' });
    }

    // Start SSH connection asynchronously
    installScript({ ip, username: username || 'root', password, privateKey, authType, domain, os }, socketId);

    res.json({ message: 'Installation started', status: 'processing' });
});

async function installScript(config, socketId) {
    const { ip, username, password, privateKey, authType, domain, os } = config;
    const conn = new Client();
    const socket = io.to(socketId);

    const sshConfig = {
        host: ip,
        port: 22,
        username: username,
        readyTimeout: 20000
    };

    if (authType === 'key') {
        sshConfig.privateKey = privateKey;
    } else {
        sshConfig.password = password;
    }

    conn.on('ready', () => {
        socket.emit('log', `Connected to ${ip}...`);

        socket.emit('log', `Target OS: ${os}`);

        let depsCmd = 'apt-get update && apt-get install -y vnstat curl';

        // While script is universal, we might want specific tweaks.
        // For now, we just acknowledge the selection.
        if (os.includes('ubuntu')) {
             // Ubuntu specific checks if needed
        } else if (os.includes('debian')) {
             // Debian specific checks if needed
        }

        socket.emit('log', 'Installing dependencies (vnstat, speedtest-cli)...');

        // Safe command construction. Domain is validated above.
        const cmd = `
            export DEBIAN_FRONTEND=noninteractive
            ${depsCmd}
            # Install Speedtest CLI
            curl -s https://packagecloud.io/install/repositories/ookla/speedtest-cli/script.deb.sh | bash
            apt-get install -y speedtest

            # Download and Run Install Script
            curl -O https://raw.githubusercontent.com/2026musik-code/autoscrip/main/install2.sh
            chmod +x install2.sh
            # Pipe domain to the script
            echo "${domain}" | ./install2.sh
        `;

        conn.exec(cmd, (err, stream) => {
            if (err) {
                socket.emit('log', `Exec error: ${err.message}`);
                conn.end();
                return;
            }

            let output = '';

            stream.on('close', (code, signal) => {
                socket.emit('log', `Process exited with code: ${code}`);
                conn.end();

                // Parse UUID/Admin Pass from output if success
                // The script outputs: Admin Pass: <UUID>
                const match = output.match(/Admin Pass:\s+([a-f0-9-]+)/);
                const adminPass = match ? match[1] : null;

                if (code === 0 && adminPass) {
                    const db = getDB();

                    const serverRecord = {
                        id: Date.now(),
                        ip: ip,
                        domain: domain,
                        username: username,
                        admin_uuid: adminPass,
                        os: os,
                        installed_at: new Date().toISOString(),
                        authType: authType
                    };

                    // Encrypt credentials
                    if (authType === 'password') {
                        serverRecord.password = encrypt(password);
                    } else {
                        serverRecord.privateKey = encrypt(privateKey);
                    }

                    db.servers.push(serverRecord);
                    saveDB(db);
                    socket.emit('status', {
                        status: 'success',
                        data: {
                            domain: domain,
                            uuid: adminPass,
                            adminUrl: `https://${domain}/admin_login.php`
                        }
                    });
                    socket.emit('log', 'Installation successful! Data saved.');
                } else {
                    socket.emit('status', { status: 'error' });
                    socket.emit('log', 'Installation failed or could not parse Admin UUID.');
                }

            }).on('data', (data) => {
                const text = data.toString();
                output += text;
                socket.emit('log', text);
            }).stderr.on('data', (data) => {
                socket.emit('log', `ERR: ${data}`);
            });
        });

    }).on('error', (err) => {
        socket.emit('log', `Connection Error: ${err.message}`);
        socket.emit('status', { status: 'error' });
    }).connect(sshConfig);
}

// Admin API: List Servers
app.get('/api/servers', authMiddleware, (req, res) => {
    const db = getDB();
    // Return sanitized data (hide sensitive fields)
    const sanitized = db.servers.map(s => {
        const { password, privateKey, ...rest } = s;
        return rest;
    });
    res.json(sanitized);
});

// Admin API: Delete Server
app.delete('/api/servers/:id', authMiddleware, (req, res) => {
    const db = getDB();
    db.servers = db.servers.filter(s => s.id != req.params.id);
    saveDB(db);
    res.json({ success: true });
});

function connectToSSH(serverConf, res, onSuccess) {
    const conn = new Client();
    const sshConfig = {
        host: serverConf.ip,
        username: serverConf.username,
        readyTimeout: 20000
    };

    if (serverConf.authType === 'key') {
        sshConfig.privateKey = decrypt(serverConf.privateKey);
    } else {
        sshConfig.password = decrypt(serverConf.password || ""); // Fallback if old records have plain text (not handled here for simplicity, assuming fresh install)
    }

    conn.on('ready', () => onSuccess(conn))
        .on('error', (err) => res.status(500).json({ error: err.message }))
        .connect(sshConfig);
}

// Monitoring API: Get Traffic & Speed
app.post('/api/monitor', authMiddleware, (req, res) => {
    const { id } = req.body;
    const db = getDB();
    const serverConf = db.servers.find(s => s.id == id);
    if (!serverConf) return res.status(404).json({ error: 'Server not found' });

    connectToSSH(serverConf, res, (conn) => {
        conn.exec('vnstat --json; speedtest --json', (err, stream) => {
             if (err) { conn.end(); return res.status(500).json({ error: err.message }); }
             let output = '';
             stream.on('close', () => {
                 conn.end();
                 res.json({ raw: output });
             }).on('data', d => output += d);
        });
    });
});

// Admin API: Manage Tokens
app.post('/api/token', authMiddleware, (req, res) => {
    const { id, action, tokenData } = req.body; // action: 'add', 'delete'
    const db = getDB();
    const serverConf = db.servers.find(s => s.id == id);
    if (!serverConf) return res.status(404).json({ error: 'Server not found' });

    connectToSSH(serverConf, res, (conn) => {
        conn.exec('cat /etc/vpanel_tokens.json', (err, stream) => {
             if (err) { conn.end(); return res.status(500).json({ error: err.message }); }
             let fileContent = '';
             stream.on('close', () => {
                 let tokens = [];
                 try { tokens = JSON.parse(fileContent); } catch(e) {}

                 if (action === 'add') {
                     tokens.push({
                         token: tokenData.token,
                         owner_id: tokenData.owner_id,
                         created_at: new Date().toISOString()
                     });
                 } else if (action === 'delete') {
                     tokens = tokens.filter(t => t.token !== tokenData.token);
                 }

                 const newContent = JSON.stringify(tokens, null, 2);
                 const safeContent = newContent.replace(/'/g, "'\\''");

                 conn.exec(`echo '${safeContent}' > /etc/vpanel_tokens.json`, (err2, stream2) => {
                     stream2.on('close', () => {
                         conn.end();
                         res.json({ success: true, tokens });
                     });
                 });

             }).on('data', d => fileContent += d);
        });
    });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`[INFO] Admin Key configured: '${ADMIN_KEY}'`);
});
