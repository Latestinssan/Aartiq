// Utility to store and retrieve Firebase config.
//
// Renderer: localStorage (set by the landing-page flow).
// Main process: no localStorage exists there, but CloudSync/P2P need the same
// config, so the renderer mirrors every save into the main process store
// (`persistent_firebase-config` via save-persistent-data) and load() falls
// back to that when running outside a window context. Without this the main
// process Firebase app was always null and cloud sync never initialized.

const FIREBASE_CONFIG_KEY = 'comet-firebase-config';
const PERSISTENT_KEY = 'firebase-config';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

// Avoid re-pushing an unchanged config on every load()/save() call.
let lastMirroredJson: string | null = null;

function mirrorToMainProcess(config: FirebaseConfig | null): void {
  try {
    if (typeof window === 'undefined') return;
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.savePersistentData) return;
    const json = config ? JSON.stringify(config) : '';
    if (json === lastMirroredJson) return;
    lastMirroredJson = json;
    electronAPI.savePersistentData(PERSISTENT_KEY, config);
  } catch (error) {
    console.error('Failed to mirror Firebase config to main process:', error);
  }
}

function loadFromMainProcess(): FirebaseConfig | null {
  try {
    // eval'd require: invisible to the renderer bundler (it only runs in the
    // main process, where plain Node require exists).
    const nodeRequire = eval('require') as NodeRequire;
    const Store = nodeRequire('electron-store');
    const store = new Store();
    const mirrored = store.get(`persistent_${PERSISTENT_KEY}`);
    if (mirrored && typeof mirrored === 'object' && (mirrored as any).apiKey) {
      return mirrored as FirebaseConfig;
    }
  } catch (error) {
    // Not in the main process (or no config yet) — renderer path already tried.
  }
  return null;
}

export const firebaseConfigStorage = {
  save: (config: FirebaseConfig) => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(FIREBASE_CONFIG_KEY, JSON.stringify(config));
      }
      mirrorToMainProcess(config);
    } catch (error) {
      console.error('Failed to save Firebase config:', error);
    }
  },

  load: (): FirebaseConfig | null => {
    try {
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(FIREBASE_CONFIG_KEY);
        if (stored) {
          const config = JSON.parse(stored) as FirebaseConfig;
          // Config may have been saved before mirroring existed — push it once.
          mirrorToMainProcess(config);
          return config;
        }
      }
      return loadFromMainProcess();
    } catch (error) {
      console.error('Failed to load Firebase config:', error);
    }
    return null;
  },

  clear: () => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(FIREBASE_CONFIG_KEY);
      }
      mirrorToMainProcess(null);
    } catch (error) {
      console.error('Failed to clear Firebase config:', error);
    }
  }
};
