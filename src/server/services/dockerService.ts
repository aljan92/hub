import http from 'http';
import fs from 'fs';

function getDockerSocketPath(): string {
  if (fs.existsSync('/var/run/docker.sock')) return '/var/run/docker.sock';
  if (fs.existsSync('/run/docker.sock')) return '/run/docker.sock';
  return '/var/run/docker.sock';
}

export class DockerService {
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
