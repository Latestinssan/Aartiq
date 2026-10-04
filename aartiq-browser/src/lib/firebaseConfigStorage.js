"use strict";
// Utility to store and retrieve Firebase config.
//
// Renderer: localStorage (set by the landing-page flow).
// Main process: no localStorage exists there, but CloudSync/P2P need the same
// config, so the renderer mirrors every save into the main process store
// (`persistent_firebase-config` via save-persistent-data) and load() falls
// back to that when running outside a window context. Without this the main
// process Firebase app was always null and cloud sync never initialized.
Object.defineProperty(exports, "__esModule", { value: true });
exports.firebaseConfigStorage = void 0;
var FIREBASE_CONFIG_KEY = 'comet-firebase-config';
var PERSISTENT_KEY = 'firebase-config';
// Avoid re-pushing an unchanged config on every load()/save() call.
var lastMirroredJson = null;
function mirrorToMainProcess(config) {
    try {
        if (typeof window === 'undefined')
            return;
        var electronAPI = window.electronAPI;
        if (!(electronAPI === null || electronAPI === void 0 ? void 0 : electronAPI.savePersistentData))
            return;
        var json = config ? JSON.stringify(config) : '';
        if (json === lastMirroredJson)
            return;
        lastMirroredJson = json;
        electronAPI.savePersistentData(PERSISTENT_KEY, config);
    }
    catch (error) {
        console.error('Failed to mirror Firebase config to main process:', error);
    }
}
function loadFromMainProcess() {
    try {
        // eval'd require: invisible to the renderer bundler (it only runs in the
        // main process, where plain Node require exists).
        var nodeRequire = eval('require');
        var Store = nodeRequire('electron-store');
        var store = new Store();
        var mirrored = store.get("persistent_".concat(PERSISTENT_KEY));
        if (mirrored && typeof mirrored === 'object' && mirrored.apiKey) {
            return mirrored;
        }
    }
    catch (error) {
        // Not in the main process (or no config yet) — renderer path already tried.
    }
    return null;
}
exports.firebaseConfigStorage = {
    save: function (config) {
        try {
            if (typeof window !== 'undefined') {
                localStorage.setItem(FIREBASE_CONFIG_KEY, JSON.stringify(config));
            }
            mirrorToMainProcess(config);
        }
        catch (error) {
            console.error('Failed to save Firebase config:', error);
        }
    },
    load: function () {
        try {
            if (typeof window !== 'undefined') {
                var stored = localStorage.getItem(FIREBASE_CONFIG_KEY);
                if (stored) {
                    var config = JSON.parse(stored);
                    // Config may have been saved before mirroring existed — push it once.
                    mirrorToMainProcess(config);
                    return config;
                }
            }
            return loadFromMainProcess();
        }
        catch (error) {
            console.error('Failed to load Firebase config:', error);
        }
        return null;
    },
    clear: function () {
        try {
            if (typeof window !== 'undefined') {
                localStorage.removeItem(FIREBASE_CONFIG_KEY);
            }
            mirrorToMainProcess(null);
        }
        catch (error) {
            console.error('Failed to clear Firebase config:', error);
        }
    }
};
