# VPS Tunneling Auto-Installer Web Panel

A web-based application to automate the installation of tunneling scripts (Xray, V2Ray, Trojan) on Debian/Ubuntu VPS instances. This tool provides a user-friendly interface to connect to a VPS via SSH, execute installation scripts, and manage the installed servers.

## Features

*   **Automated Installation**: Connects to your VPS (supports Password & SSH Key auth) and installs the tunneling script automatically.
*   **Real-time Logs**: View installation logs in real-time via the web interface.
*   **Success Feedback**: Automatically captures and displays the Admin UUID and Login URL upon successful installation.
*   **Admin Panel**: Secured dashboard to view all managed servers.
*   **Server Monitoring**: Check traffic usage (`vnstat`) and internet speed (`speedtest`) of your VPS directly from the panel.
*   **Token Management**: Manage `vpanel_tokens.json` (Add/Delete tokens) remotely.
*   **Secure Storage**: VPS credentials are stored locally (`db.json`) using AES encryption.

## Prerequisites

*   Node.js (v14 or higher)
*   NPM (Node Package Manager)
*   *Optional*: Docker (for containerized deployment)

## Local Installation

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/your-repo/autoscrip.git
    cd autoscrip
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```

3.  **Configuration (Optional)**
    You can set environment variables to secure your admin panel and encryption. Create a `.env` file or export them:

    ```bash
    export PORT=3000
    export ADMIN_KEY="your_secure_admin_password"
    export ENCRYPTION_KEY="your_random_long_string_for_aes"
    ```

    *Defaults:*
    *   `PORT`: 3000
    *   `ADMIN_KEY`: `secret123`
    *   `ENCRYPTION_KEY`: `mySuperSecretKey123`

4.  **Run the Application**
    ```bash
    npm start
    ```

5.  **Access the Web Interface**
    Open your browser and navigate to `http://localhost:3000`.

## VPS One-Click Installation (Recommended)

To install the panel directly on your VPS with a single command:

```bash
bash <(curl -Ls https://raw.githubusercontent.com/2026musik-code/autoscrip/main/setup.sh)
```

This will:
1. Install Node.js and dependencies.
2. Setup the Web Panel on port 3000.
3. Generate a secure **Admin Key**.
4. Start the service automatically.

## Docker Deployment (Northflank / Railway / Etc.)

This project includes a `Dockerfile` for easy deployment.

1.  **Build the Image**
    ```bash
    docker build -t vps-installer .
    ```

2.  **Run the Container**
    ```bash
    docker run -d -p 3000:3000 \
      -e ADMIN_KEY="your_secure_admin_password" \
      -e ENCRYPTION_KEY="your_encryption_key" \
      vps-installer
    ```

### Deploying to Northflank

1.  Create a new **Service**.
2.  Select **Docker** as the build type.
3.  Connect your repository.
4.  In **Environment Variables**, add:
    *   `ADMIN_KEY`: Your desired admin password.
    *   `ENCRYPTION_KEY`: A strong random string.
5.  Expose Port **3000** (HTTP).

## Usage Guide

### 1. Install Script on VPS
1.  Go to the **Home Page**.
2.  Enter your VPS **IP Address**.
3.  Enter the **Username** (default: `root`).
4.  Select Authentication Type:
    *   **Password**: Enter the root password.
    *   **SSH Private Key**: Paste your private key content.
5.  Enter the **Domain Name** you want to configure (e.g., `vpn.myserver.com`).
6.  Select the **OS** (Debian/Ubuntu).
7.  Click **START INSTALLATION**.
8.  Wait for the logs to finish. A popup will appear with your **Admin UUID** and **Login URL**.

### 2. Admin Panel
1.  Click the **Admin Panel** link at the bottom of the home page.
2.  Enter your `ADMIN_KEY` to login.
3.  **Monitor**: Click "Monitor" on a server to see live traffic and speed test results.
4.  **Tokens**: In the monitor modal, you can add or delete user tokens for the VPanel.
5.  **Delete**: Remove the server from the local database (does not uninstall script from VPS).

## Security Note

*   **Credentials**: Passwords and Keys are encrypted in `db.json`. However, ensure `db.json` is not publicly accessible.
*   **Admin Key**: Change the default `ADMIN_KEY` immediately in production!

## License

ISC
