const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client } = require('ssh2');
const fs = require('fs');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const DB_FILE = 'db.json';
const INSTALL_SCRIPT = 'install_enhanced.sh';

// Helper to read DB
function getHistory() {
    if (!fs.existsSync(DB_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
        return [];
    }
}

// Helper to save DB
function saveHistory(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/history', (req, res) => {
    res.json(getHistory());
});

app.delete('/api/history/:id', (req, res) => {
    const id = req.params.id;
    let history = getHistory();
    history = history.filter(item => item.id !== id);
    saveHistory(history);
    res.json({ success: true });
});

io.on('connection', (socket) => {
    console.log('A client connected');

    socket.on('start_install', (data) => {
        const { ip, port, username, password, privateKey, domain } = data;
        const conn = new Client();

        socket.emit('log', `Connecting to ${username}@${ip}:${port}...\n`);

        conn.on('ready', () => {
            socket.emit('log', `Connected! Uploading installation script...\n`);

            // Read the script
            const scriptContent = fs.readFileSync(INSTALL_SCRIPT, 'utf8');

            // Upload via SFTP or just cat to file
            conn.sftp((err, sftp) => {
                if (err) {
                    socket.emit('log', `SFTP Error: ${err.message}\n`);
                    conn.end();
                    return;
                }

                const remotePath = '/root/install_enhanced.sh';
                const writeStream = sftp.createWriteStream(remotePath);

                writeStream.on('close', () => {
                    socket.emit('log', `Script uploaded. Making executable...\n`);

                    // Run the script
                    // We need to pass DOMAIN as env var or input. The script asks for input if not set.
                    // We can prepend DOMAIN=... to the command.

                    // Convert line endings just in case
                    conn.exec(`sed -i 's/\r$//' ${remotePath} && chmod +x ${remotePath} && export DOMAIN="${domain}" && bash ${remotePath}`, (err, stream) => {
                        if (err) {
                            socket.emit('log', `Exec Error: ${err.message}\n`);
                            conn.end();
                            return;
                        }

                        let outputBuffer = "";

                        stream.on('close', (code, signal) => {
                            socket.emit('log', `\nProcess finished with code: ${code}\n`);
                            conn.end();

                            if (code === 0) {
                                // Extract Admin Pass (UUID) from output
                                const uuidMatch = outputBuffer.match(/Admin Pass: ([a-f0-9-]+)/);
                                const adminPass = uuidMatch ? uuidMatch[1] : 'Unknown';

                                const newRecord = {
                                    id: Date.now().toString(),
                                    date: new Date().toISOString(),
                                    ip,
                                    domain,
                                    adminUrl: `https://${domain}/admin_login.php`,
                                    adminPass: adminPass
                                };
                                const history = getHistory();
                                history.push(newRecord);
                                saveHistory(history);
                                socket.emit('install_success', newRecord);
                            } else {
                                socket.emit('install_error', 'Installation failed (non-zero exit code).');
                            }
                        }).on('data', (data) => {
                            const str = data.toString();
                            outputBuffer += str;
                            socket.emit('log', str);
                        }).stderr.on('data', (data) => {
                            socket.emit('log', data.toString());
                        });
                    });
                });

                writeStream.write(scriptContent);
                writeStream.end();
            });

        }).on('error', (err) => {
            socket.emit('log', `Connection Error: ${err.message}\n`);
            socket.emit('install_error', err.message);
        }).connect({
            host: ip,
            port: parseInt(port),
            username: username,
            password: password || undefined,
            privateKey: privateKey || undefined,
            readyTimeout: 20000
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
