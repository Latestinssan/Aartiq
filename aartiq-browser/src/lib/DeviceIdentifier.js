"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceIdentifier = void 0;
var os = __importStar(require("os"));
var child_process_1 = require("child_process");
var DeviceIdentifier = /** @class */ (function () {
    function DeviceIdentifier() {
    }
    DeviceIdentifier.getDeviceMetadata = function () {
        if (DeviceIdentifier.cachedMetadata) {
            return DeviceIdentifier.cachedMetadata;
        }
        var platform = os.platform();
        var hostname = os.hostname();
        var deviceName = hostname;
        var model = 'Personal Computer';
        var deviceType = 'desktop';
        var deviceImage = 'windows-pc';
        var osVersion = "".concat(platform, " ").concat(os.release());
        if (platform === 'darwin') {
            deviceImage = 'macbook';
            deviceType = 'laptop';
            // Friendly computer name from macOS
            try {
                var scutilName = (0, child_process_1.execSync)('scutil --get ComputerName', { encoding: 'utf8', timeout: 1500 }).trim();
                if (scutilName)
                    deviceName = scutilName;
            }
            catch (_) {
                try {
                    var host = (0, child_process_1.execSync)('scutil --get LocalHostName', { encoding: 'utf8', timeout: 1500 }).trim();
                    if (host)
                        deviceName = host;
                }
                catch (_) { }
            }
            // Hardware model
            try {
                var hwModel = (0, child_process_1.execSync)('sysctl -n hw.model', { encoding: 'utf8', timeout: 1500 }).trim();
                if (hwModel) {
                    if (hwModel.toLowerCase().includes('macbook')) {
                        model = 'MacBook Pro / Air';
                        deviceType = 'laptop';
                        deviceImage = 'macbook';
                    }
                    else if (hwModel.toLowerCase().includes('imac')) {
                        model = 'iMac';
                        deviceType = 'desktop';
                        deviceImage = 'imac';
                    }
                    else if (hwModel.toLowerCase().includes('macmini') || hwModel.toLowerCase().includes('macstudio')) {
                        model = 'Mac Studio / Mini';
                        deviceType = 'desktop';
                        deviceImage = 'imac';
                    }
                    else {
                        model = hwModel;
                    }
                }
            }
            catch (_) {
                model = 'Apple Silicon Mac';
            }
            try {
                var swVers = (0, child_process_1.execSync)('sw_vers -productVersion', { encoding: 'utf8', timeout: 1500 }).trim();
                if (swVers)
                    osVersion = "macOS ".concat(swVers);
            }
            catch (_) { }
        }
        else if (platform === 'win32') {
            deviceType = 'desktop';
            deviceImage = 'windows-pc';
            deviceName = process.env.COMPUTERNAME || hostname;
            try {
                var wmicModel = (0, child_process_1.execSync)('wmic csproduct get name', { encoding: 'utf8', timeout: 2000 })
                    .replace('Name', '')
                    .trim();
                if (wmicModel) {
                    model = wmicModel;
                    if (wmicModel.toLowerCase().includes('laptop') || wmicModel.toLowerCase().includes('thinkpad') || wmicModel.toLowerCase().includes('surface')) {
                        deviceType = 'laptop';
                        deviceImage = 'windows-laptop';
                    }
                }
            }
            catch (_) {
                model = 'Windows Workstation';
            }
            osVersion = "Windows ".concat(os.release());
        }
        else if (platform === 'linux') {
            deviceType = 'desktop';
            deviceImage = 'linux-pc';
            try {
                var pretty = (0, child_process_1.execSync)('hostnamectl --pretty', { encoding: 'utf8', timeout: 1500 }).trim();
                if (pretty)
                    deviceName = pretty;
            }
            catch (_) { }
            try {
                var chassis = (0, child_process_1.execSync)('hostnamectl chassis', { encoding: 'utf8', timeout: 1500 }).trim();
                if (chassis === 'laptop') {
                    deviceType = 'laptop';
                }
            }
            catch (_) { }
        }
        var deviceId = "desktop-".concat(hostname.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 10));
        DeviceIdentifier.cachedMetadata = {
            deviceId: deviceId,
            deviceName: deviceName,
            hostname: hostname,
            model: model,
            deviceType: deviceType,
            deviceImage: deviceImage,
            platform: platform,
            osVersion: osVersion,
        };
        return DeviceIdentifier.cachedMetadata;
    };
    DeviceIdentifier.cachedMetadata = null;
    return DeviceIdentifier;
}());
exports.DeviceIdentifier = DeviceIdentifier;
