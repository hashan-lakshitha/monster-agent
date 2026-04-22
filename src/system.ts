import { execSync } from 'child_process';
import os from 'os';

export function getGatewayIp(): string {
    try {
        if (process.platform === 'linux') {
            const res = execSync("ip route show | grep default", { encoding: 'utf-8' });
            const match = res.match(/via\s+([\d\.]+)/);
            if (match) {
                let gw = match[1];
                return gw.endsWith(".2") ? gw.substring(0, gw.lastIndexOf('.')) + ".1" : gw;
            }
        }
    } catch (e) {}
    // Fallback if not inside Linux VM
    return "127.0.0.1";
}

export function getSystemContext() {
    let localIp = '127.0.0.1';
    let user = 'unknown';
    
    try {
        user = os.userInfo().username;
        if (process.platform === 'linux') {
            localIp = execSync("hostname -I", { encoding: 'utf-8' }).trim().split(" ")[0];
        } else {
            const interfaces = os.networkInterfaces();
            for (const name of Object.keys(interfaces)) {
                for (const net of interfaces[name]!) {
                    if (net.family === 'IPv4' && !net.internal) {
                        localIp = net.address;
                        break;
                    }
                }
            }
        }
    } catch(e) {}
    
    return { user, localIp };
}
