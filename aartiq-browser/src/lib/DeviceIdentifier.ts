import * as os from 'os';
import { execSync } from 'child_process';

export interface LocalDeviceMetadata {
    deviceId: string;
    deviceName: string;       // Friendly name, e.g. "Sandip's MacBook Pro"
    hostname: string;
    model: string;            // Hardware model, e.g. "MacBook Pro 16-inch (M1 Pro)"
    deviceType: 'laptop' | 'desktop' | 'workstation';
    deviceImage: 'macbook' | 'imac' | 'windows-laptop' | 'windows-pc' | 'linux-pc';
    platform: string;
    osVersion: string;
}

export class DeviceIdentifier {
    private static cachedMetadata: LocalDeviceMetadata | null = null;

    public static getDeviceMetadata(): LocalDeviceMetadata {
        if (DeviceIdentifier.cachedMetadata) {
            return DeviceIdentifier.cachedMetadata;
        }

        const platform = os.platform();
        const hostname = os.hostname();
        let deviceName = hostname;
        let model = 'Personal Computer';
        let deviceType: 'laptop' | 'desktop' | 'workstation' = 'desktop';
        let deviceImage: 'macbook' | 'imac' | 'windows-laptop' | 'windows-pc' | 'linux-pc' = 'windows-pc';
        let osVersion = `${platform} ${os.release()}`;

        if (platform === 'darwin') {
            deviceImage = 'macbook';
            deviceType = 'laptop';
            // Friendly computer name from macOS
            try {
                const scutilName = execSync('scutil --get ComputerName', { encoding: 'utf8', timeout: 1500 }).trim();
                if (scutilName) deviceName = scutilName;
            } catch (_) {
                try {
                    const host = execSync('scutil --get LocalHostName', { encoding: 'utf8', timeout: 1500 }).trim();
                    if (host) deviceName = host;
                } catch (_) {}
            }

            // Hardware model
            try {
                const hwModel = execSync('sysctl -n hw.model', { encoding: 'utf8', timeout: 1500 }).trim();
                if (hwModel) {
                    if (hwModel.toLowerCase().includes('macbook')) {
                        model = 'MacBook Pro / Air';
                        deviceType = 'laptop';
                        deviceImage = 'macbook';
                    } else if (hwModel.toLowerCase().includes('imac')) {
                        model = 'iMac';
                        deviceType = 'desktop';
                        deviceImage = 'imac';
                    } else if (hwModel.toLowerCase().includes('macmini') || hwModel.toLowerCase().includes('macstudio')) {
                        model = 'Mac Studio / Mini';
                        deviceType = 'desktop';
                        deviceImage = 'imac';
                    } else {
                        model = hwModel;
                    }
                }
            } catch (_) {
                model = 'Apple Silicon Mac';
            }

            try {
                const swVers = execSync('sw_vers -productVersion', { encoding: 'utf8', timeout: 1500 }).trim();
                if (swVers) osVersion = `macOS ${swVers}`;
            } catch (_) {}
        } else if (platform === 'win32') {
            deviceType = 'desktop';
            deviceImage = 'windows-pc';
            deviceName = process.env.COMPUTERNAME || hostname;
            try {
                const wmicModel = execSync('wmic csproduct get name', { encoding: 'utf8', timeout: 2000 })
                    .replace('Name', '')
                    .trim();
                if (wmicModel) {
                    model = wmicModel;
                    if (wmicModel.toLowerCase().includes('laptop') || wmicModel.toLowerCase().includes('thinkpad') || wmicModel.toLowerCase().includes('surface')) {
                        deviceType = 'laptop';
                        deviceImage = 'windows-laptop';
                    }
                }
            } catch (_) {
                model = 'Windows Workstation';
            }
            osVersion = `Windows ${os.release()}`;
        } else if (platform === 'linux') {
            deviceType = 'desktop';
            deviceImage = 'linux-pc';
            try {
                const pretty = execSync('hostnamectl --pretty', { encoding: 'utf8', timeout: 1500 }).trim();
                if (pretty) deviceName = pretty;
            } catch (_) {}
            try {
                const chassis = execSync('hostnamectl chassis', { encoding: 'utf8', timeout: 1500 }).trim();
                if (chassis === 'laptop') {
                    deviceType = 'laptop';
                }
            } catch (_) {}
        }

        const deviceId = `desktop-${hostname.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 10)}`;

        DeviceIdentifier.cachedMetadata = {
            deviceId,
            deviceName,
            hostname,
            model,
            deviceType,
            deviceImage,
            platform,
            osVersion,
        };

        return DeviceIdentifier.cachedMetadata;
    }
}
