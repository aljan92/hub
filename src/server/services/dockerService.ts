import http from 'http';
import fs from 'fs';

function getDockerSocketPath(): string {
  if (fs.existsSync('/var/run/docker.sock')) return '/var/run/docker.sock';
  if (fs.existsSync('/run/docker.sock')) return '/run/docker.sock';
  return '/var/run/docker.sock';
}

export class DockerService {
  /**
   * Execute a command inside a running Docker container via Docker socket
   */
  static async execCommand(containerName: string, cmd: string[], user?: string): Promise<{ success: boolean; message: string }> {
    const socketPath = getDockerSocketPath();

    return new Promise((resolve) => {
      // 1. Create exec instance
      const payload: any = {
        AttachStdout: true,
        AttachStderr: true,
        Cmd: cmd
      };
      if (user) payload.User = user;
      const createPayload = JSON.stringify(payload);

      const createReq = http.request({
        socketPath,
        path: `/v1.41/containers/${containerName}/exec`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(createPayload)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode !== 201) {
            return resolve({ success: false, message: `Exec creation failed (${res.statusCode}): ${data}` });
          }

          try {
            const execObj = JSON.parse(data);
            const execId = execObj.Id;

            // 2. Start exec instance (detached)
            const startPayload = JSON.stringify({ Detach: true, Tty: false });
            const startReq = http.request({
              socketPath,
              path: `/v1.41/exec/${execId}/start`,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(startPayload)
              }
            }, (startRes) => {
              if (startRes.statusCode === 200 || startRes.statusCode === 204) {
                resolve({ success: true, message: 'Befehl erfolgreich im Container ausgeführt.' });
              } else {
                resolve({ success: false, message: `Exec start failed (${startRes.statusCode})` });
              }
            });

            startReq.on('error', (err) => resolve({ success: false, message: err.message }));
            startReq.write(startPayload);
            startReq.end();
          } catch (e: any) {
            resolve({ success: false, message: e.message });
          }
        });
      });

      createReq.on('error', (err: any) => {
        resolve({ success: false, message: `Docker Socket nicht erreichbar: ${err.message}` });
      });

      createReq.write(createPayload);
      createReq.end();
    });
  }

  /**
   * Launch or restart Chrome freshly on Display :99.0 inside container with Amazon Merch
   */
  static async launchOrRestartChrome(containerName: string): Promise<{ success: boolean; message: string }> {
    const status = await this.getContainerStatus(containerName);
    
    // If container is not running, start it first
    if (!status.running) {
      const restartRes = await this.restartContainer(containerName);
      if (!restartRes.success) return restartRes;
      // Wait for X-Server / XVFB to initialize
      await new Promise(r => setTimeout(r, 2500));
    }

    // Launch Chrome on active DISPLAY=:99.0 as user seluser
    const cmd = [
      "/bin/bash",
      "-c",
      "pkill -f chrome || true; pkill -f chromium || true; rm -f /home/seluser/.config/google-chrome/Singleton* /root/.config/google-chrome/Singleton* 2>/dev/null || true; DISPLAY=:99.0 google-chrome --no-sandbox --disable-dev-shm-usage --disable-gpu --start-maximized https://merch.amazon.com/dashboard >/dev/null 2>&1 &"
    ];

    const execRes = await this.execCommand(containerName, cmd, "seluser");
    if (execRes.success) {
      return { 
        success: true, 
        message: `Google Chrome wurde in ${containerName} aufgerufen und geöffnet!` 
      };
    }

    // Fallback without explicit user
    return await this.execCommand(containerName, [
      "/bin/bash",
      "-c",
      "su - seluser -c 'DISPLAY=:99.0 google-chrome --no-sandbox --disable-dev-shm-usage --start-maximized https://merch.amazon.com/dashboard &' || (export DISPLAY=:99.0; google-chrome --no-sandbox --disable-dev-shm-usage --start-maximized https://merch.amazon.com/dashboard &)"
    ]);
  }

  /**
   * Restarts a container by name via Docker Unix socket
   */
  static async restartContainer(containerName: string): Promise<{ success: boolean; message: string }> {
    const socketPath = getDockerSocketPath();
    return new Promise((resolve) => {
      const options = {
        socketPath,
        path: `/v1.41/containers/${containerName}/restart?t=3`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const req = http.request(options, (res) => {
        if (res.statusCode === 204 || res.statusCode === 200) {
          resolve({ success: true, message: `Container ${containerName} erfolgreich neugestartet.` });
        } else {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            resolve({ 
              success: false, 
              message: `Docker API (${res.statusCode}): ${data || 'Konnte Container nicht neustarten'}` 
            });
          });
        }
      });

      req.on('error', (err: any) => {
        resolve({ 
          success: false, 
          message: `Docker Socket nicht erreichbar (${err.message}). Bitte sicherstellen, dass /var/run/docker.sock gemountet ist.` 
        });
      });

      req.setTimeout(10000, () => {
        req.destroy();
        resolve({ success: false, message: 'Timeout beim Neustart des Browser-Containers.' });
      });

      req.end();
    });
  }

  /**
   * Get container status (running/exited)
   */
  static async getContainerStatus(containerName: string): Promise<{ running: boolean; status: string }> {
    const socketPath = getDockerSocketPath();
    return new Promise((resolve) => {
      const options = {
        socketPath,
        path: `/v1.41/containers/${containerName}/json`,
        method: 'GET'
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const json = JSON.parse(data);
              resolve({ 
                running: json.State?.Running || false, 
                status: json.State?.Status || 'unknown' 
              });
            } else {
              resolve({ running: false, status: `HTTP ${res.statusCode}` });
            }
          } catch {
            resolve({ running: false, status: 'error' });
          }
        });
      });

      req.on('error', () => {
        resolve({ running: false, status: 'socket_unavailable' });
      });

      req.setTimeout(5000, () => {
        req.destroy();
        resolve({ running: false, status: 'timeout' });
      });

      req.end();
    });
  }
}
