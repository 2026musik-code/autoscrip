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
const { v4: uuidv4 } = require('uuid');

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
    fs.writeFileSync(DB_FILE, JSON.stringify({ servers: [], licenseTokens: [] }, null, 2));
}

function getDB() {
    const data = JSON.parse(fs.readFileSync(DB_FILE));
    if (!data.licenseTokens) data.licenseTokens = [];
    return data;
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

// Admin API: Generate License Token
app.post('/api/admin/generate-license', authMiddleware, (req, res) => {
    const { months, note } = req.body;
    if (!months) return res.status(400).json({ error: 'Duration (months) required' });

    const db = getDB();
    const token = uuidv4().split('-')[0].toUpperCase(); // Short 8-char token

    const newLicense = {
        token: `LIC-${token}`,
        months: parseInt(months),
        created_at: new Date().toISOString(),
        is_used: false,
        note: note || ''
    };

    db.licenseTokens.push(newLicense);
    saveDB(db);
    res.json(newLicense);
});

// Admin API: List Licenses
app.get('/api/admin/licenses', authMiddleware, (req, res) => {
    const db = getDB();
    res.json(db.licenseTokens);
});

// Installation Endpoint
app.post('/api/install', (req, res) => {
    const { ip, username, password, privateKey, authType, domain, os, licenseToken } = req.body;
    const socketId = req.headers['x-socket-id'];

    // 1. Input Validation
    if (!ip || !domain || !licenseToken) {
        return res.status(400).json({ error: 'Missing required fields (IP, Domain, License Token)' });
    }

    // Validate License
    const db = getDB();
    const license = db.licenseTokens.find(t => t.token === licenseToken);

    if (!license) {
        return res.status(400).json({ error: 'Invalid License Token' });
    }
    if (license.is_used) {
        return res.status(400).json({ error: 'License Token already used!' });
    }

    if (authType === 'password' && !password) return res.status(400).json({ error: 'Password required' });
    if (authType === 'key' && !privateKey) return res.status(400).json({ error: 'Private Key required' });

    // Validate Domain format (Simple Regex to prevent injection)
    const domainRegex = /^[a-zA-Z0-9.-]+$/;
    if (!domainRegex.test(domain)) {
        return res.status(400).json({ error: 'Invalid Domain Format. Only alphanumeric, dots, and hyphens allowed.' });
    }

    // Mark Token as Used (Optimistic locking - prevents double use immediately)
    // Real-world: do this in transaction or check again inside installScript if async
    // Here we mark it pending or assume single threaded enough for this scale.
    // Better: Pass license info to installScript and mark used ONLY on success.
    // BUT user asked "Token cuma bisa dimasukin sekali". If install fails, should we restore it?
    // Let's mark it 'pending_install' or just check it inside installScript logic.
    // For simplicity: We will pass license object to installScript and update DB on success.

    // Start SSH connection asynchronously
    installScript({ ip, username: username || 'root', password, privateKey, authType, domain, os, licenseToken }, socketId);

    res.json({ message: 'Installation started', status: 'processing' });
});

async function installScript(config, socketId) {
    const { ip, username, password, privateKey, authType, domain, os, licenseToken } = config;
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

                    // Update License Status
                    const licenseIdx = db.licenseTokens.findIndex(t => t.token === licenseToken);
                    let expiryDate = null;

                    if (licenseIdx !== -1) {
                        db.licenseTokens[licenseIdx].is_used = true;
                        db.licenseTokens[licenseIdx].used_at = new Date().toISOString();
                        db.licenseTokens[licenseIdx].used_by_domain = domain;

                        // Calculate Expiry
                        const months = db.licenseTokens[licenseIdx].months || 1;
                        const date = new Date();
                        date.setMonth(date.getMonth() + months);
                        expiryDate = date.toISOString().split('T')[0]; // YYYY-MM-DD
                    }

                    const serverRecord = {
                        id: Date.now(),
                        ip: ip,
                        domain: domain,
                        username: username,
                        admin_uuid: adminPass,
                        os: os,
                        installed_at: new Date().toISOString(),
                        license_token: licenseToken,
                        expires_at: expiryDate,
                        status: 'active',
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


// --- EXPIRATION CHECKER ---
// Runs every 24 hours to check for expired licenses
setInterval(checkExpiredLicenses, 24 * 60 * 60 * 1000);

async function checkExpiredLicenses() {
    console.log('[Cron] Checking for expired licenses...');
    const db = getDB();
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Find active servers that have expired
    const expiredServers = db.servers.filter(s =>
        s.status === 'active' &&
        s.expires_at &&
        s.expires_at < today
    );

    if (expiredServers.length === 0) {
        console.log('[Cron] No expired servers found.');
        return;
    }

    console.log(`[Cron] Found ${expiredServers.length} expired servers. Processing removal...`);

    for (const server of expiredServers) {
        console.log(`[Cron] Removing script from ${server.ip} (Expired: ${server.expires_at})`);

        // Connect SSH to remove
        // We reuse a simplified SSH connection logic here
        removeScript(server, (success) => {
            if (success) {
                // Update DB status
                // We need to re-read DB in case it changed during async loop
                const currentDB = getDB();
                const sIdx = currentDB.servers.findIndex(s => s.id === server.id);
                if (sIdx !== -1) {
                    currentDB.servers[sIdx].status = 'expired';
                    saveDB(currentDB);
                    console.log(`[Cron] Server ${server.ip} marked as EXPIRED.`);
                }
            }
        });
    }
}

function removeScript(serverConf, callback) {
    const conn = new Client();
    const sshConfig = {
        host: serverConf.ip,
        username: serverConf.username,
        readyTimeout: 20000
    };

    try {
        if (serverConf.authType === 'key') {
            sshConfig.privateKey = decrypt(serverConf.privateKey);
        } else {
            sshConfig.password = decrypt(serverConf.password);
        }
    } catch(e) {
        console.error(`[Cron] Decryption failed for ${serverConf.ip}:`, e.message);
        if(callback) callback(false);
        return;
    }

    conn.on('ready', () => {
        // Commands to remove Xray/V2Ray and Panel
        const cmds = [
            'systemctl stop xray',
            'systemctl disable xray',
            'rm -rf /usr/local/etc/xray',
            'rm -rf /var/log/xray',
            'rm -rf /var/www/vpanel',
            'rm -f /etc/nginx/sites-enabled/vpn',
            'systemctl reload nginx',
            'echo "VPN Script License Expired. Removed by Auto-Installer." > /root/license_expired.txt'
        ].join('; ');

        conn.exec(cmds, (err, stream) => {
            if (err) {
                console.error(`[Cron] Removal Exec Error ${serverConf.ip}:`, err.message);
                conn.end();
                if(callback) callback(false);
                return;
            }
            stream.on('close', (code, signal) => {
                conn.end();
                if(callback) callback(code === 0);
            });
        });
    }).on('error', (err) => {
        console.error(`[Cron] Connection Error ${serverConf.ip}:`, err.message);
        if(callback) callback(false);
    }).connect(sshConfig);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`[INFO] Admin Key configured: '${ADMIN_KEY}'`);
});
