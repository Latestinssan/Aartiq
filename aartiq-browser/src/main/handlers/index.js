const registerAppHandlers = require('./app-handlers.js');
const registerAiHandlers = require('./ai-handlers.js');
const registerAuthHandlers = require('./auth-handlers.js');
const registerBrowserHandlers = require('./browser-handlers.js');
const registerAutomationHandlers = require('./automation-handlers.js');
const registerSyncHandlers = require('./sync-handlers.js');
const registerFileHandlers = require('./file-handlers.js');
const registerPermissionHandlers = require('./permission-handlers.js');
const registerMcpHandlers = require('./mcp-handlers.js');
const registerSystemHandlers = require('./system-handlers.js');
const registerPluginHandlers = require('./plugin-handlers.js');
const registerExtensionHandlers = require('./extension-handlers.js');
const registerMemoryHandlers = require('./memory-handlers.js');
const registerRagHandlers = require('./rag-handlers.js');
const registerVoiceWorkflowHandlers = require('./voice-workflow-handlers.js');
const registerAutofillHandlers = require('./autofill-handlers.js');

const utils = require('./utils.js');

function registerAllHandlers(ipcMain, handlers) {
  console.log('[Handlers] Registering all IPC handlers...');

  // Pre-clean all module channels to support refactoring from monolithic main.js.
  // This removes any previously-registered inline handlers before the module versions take over.
  const handleChannels = [
    'get-app-version','get-platform','get-app-icon','get-app-icon-base64','get-icon-path',
    'bring-window-to-top','check-for-updates','quit-and-install','open-external-url',
    'show-save-dialog','show-open-dialog','open-system-settings','set-as-default-browser',
    'set-native-theme-source','get-is-online',
    'execute-javascript','search-dom','dom-fill-form','get-browser-view-url','capture-page-html',
    'capture-browser-view-screenshot','get-open-tabs',
    'robot-execute','robot-execute-sequence','robot-kill','robot-reset-kill','robot-status',
    'perform-ocr','ocr-capture-words','ocr-click','ocr-screen-text',
    'vision-describe','vision-analyze','vision-capture-base64','classify-tabs-ai','click-element',
    'get-selected-text','type-text','fill-form','find-and-click-text',
    'dom-click-element','dom-find-element','dom-get-page-info',
    'extract-secure-dom',
    'translate-website','extract-page-content','extract-search-results','get-suggestions',
    'get-auth-token','get-user-info','get-auth-session',
    'get-autofill-data','get-passwords-for-site','vault-list-entries','vault-save-entry',
    'vault-delete-entry','vault-read-secret','vault-copy-secret',
    'vault-generate-totp','vault-save-totp-secret','vault-remove-totp-secret','vault-read-audit-log',
    'llm-get-available-providers','llm-get-provider-models','llm-set-active-provider',
    'llm-configure-provider','llm-generate-chat-content',
    'ai-engine-chat','ai-engine-configure','test-gemini-api','get-stored-api-keys',
    'ollama-list-models',
    'get-wifi-sync-uri','wifi-sync-broadcast','get-wifi-sync-qr','get-wifi-sync-info',
    'get-active-sync-devices','sync-remove-device',
    'generate-high-risk-qr','generate-shell-ticket-qr','login-to-cloud','logout-from-cloud','save-cloud-config',
    'get-cloud-devices','connect-to-cloud-device','disconnect-from-cloud-device',
    'sync-clipboard','sync-history','send-desktop-control','connect-to-remote-device',
    'forward-ai-stream',
    'p2p-sync-history','p2p-get-device-id',
    'bridge-get-pairing-code','bridge-get-status','bridge-rotate-secret','bridge-broadcast',
    'read-file-buffer','select-local-file','open-file','scan-folder',
    'save-persistent-data','load-persistent-data','delete-persistent-data',
    'get-onboarding-state','set-onboarding-state','load-skill',
    'generate-pdf','generate-xlsx','generate-docx','generate-pptx',
    'export-chat-txt','export-chat-pdf',
    'perm-grant','perm-revoke','perm-revoke-all','perm-check','perm-list','perm-audit-log',
    'permission-auto-command','permission-auto-action','permission-auto-commands','permission-auto-actions',
    'set-proxy','network-security-get','network-security-update','security-settings-get','security-settings-update',
    'mcp-connect-server','mcp-disconnect-server','mcp-list-servers','mcp-get-tools','mcp-command',
    'mcp-get-server-status','mcp-list-tools','mcp-call-tool','mcp-remove-server',
    'mcp-fs-read','mcp-fs-write','mcp-fs-list','mcp-fs-approved-dirs',
    'mcp-native-applescript','mcp-native-powershell','mcp-native-active-window',
    'execute-shell-command','get-extensions','toggle-extension','uninstall-extension',
    'get-extension-path','search-applications','open-external-app','show-item-in-folder',
    'set-volume','set-brightness','set-alarm','encrypt-data','decrypt-data',
    'create-desktop-shortcut','biometric-check','biometric-authenticate','biometric-execute',
    'check-python-available',
    'file-move','file-copy','file-open','file-print','file-check-access',
    'request-directory-access',
    'directory-allowlist-get','directory-allowlist-add','directory-allowlist-remove',
    'directory-get-broad-grants-warning','directory-narrow-broad-grants','directory-dismiss-broad-grants-warning',
    'plugins:list','plugins:get','plugins:install','plugins:uninstall','plugins:update',
    'plugins:enable','plugins:disable','plugins:get-commands','plugins:execute-command',
    'plugins:update-config','plugins:get-dir','plugins:scan',
    'plugin-api:read-file','plugin-api:write-file','plugin-api:log',
    'install-extension-folder','install-extension-crx','enable-extension','disable-extension',
    'select-and-install-extension',
    'get-extension-actions','open-extension-popup',
    'autofill:list','autofill:get','autofill:add','autofill:update','autofill:delete',
    'autofill:detect','autofill:fill',
    'get-ai-memory','save-vector-store','load-vector-store','clear-vector-store',
    'memory:collect','memory:flush','memory:stats',
    'rag-ingest','rag-retrieve','rag-context','rag-stats','rag-delete-source','rag-clear',
    'voice-transcribe','voice-mic-permission','workflow-start','workflow-record',
    'workflow-stop','workflow-save','workflow-list','workflow-replay','workflow-delete',
    'workflow-status',
    'user-preference:save','user-preference:load-all','user-preference:delete',
    'pop-search-show','pop-search-show-at-cursor','pop-search-get-config',
    'pop-search-update-config','pop-search-save-config','pop-search-load-config',
    'popup-action',
  ];
  const onChannels = [
    'minimize-window','maximize-window','close-window','toggle-fullscreen',
    'create-view','suspend-tab','resume-tab','activate-view','destroy-view',
    'set-browser-view-bounds','navigate-browser-view','browser-view-go-back',
    'browser-view-go-forward','browser-view-reload','change-zoom','open-dev-tools',
    'save-auth-token','save-auth-session','clear-auth',
    'propose-password-save','propose-form-collection-save','open-auth-window','close-auth-window',
    'llm-stream-chat-content',
    'add-ai-memory',
    'send-p2p-signal',
    'wifi-sync-set-last-clipboard',
    'open-extension-dir','close-extension-popup','raycast-update-state',
    'open-popup-window','close-popup-window','close-all-popups',
    'open-settings-popup','open-profile-popup','open-plugins-popup','open-downloads-popup',
    'open-clipboard-popup','open-cart-popup','open-search-popup','open-translate-popup',
    'open-context-menu-popup',
    'hide-all-views','show-all-views',
  ];
  handleChannels.forEach(ch => { try { ipcMain.removeHandler(ch); } catch (e) {} });
  onChannels.forEach(ch => { try { ipcMain.removeAllListeners(ch); } catch (e) {} });

  // Merge utils into handlers for convenience
  const enrichedHandlers = { ...handlers, ...utils };

  registerAppHandlers(ipcMain, enrichedHandlers);
  registerAiHandlers(ipcMain, enrichedHandlers);
  registerAuthHandlers(ipcMain, enrichedHandlers);
  registerBrowserHandlers(ipcMain, enrichedHandlers);
  registerAutomationHandlers(ipcMain, enrichedHandlers);
  registerSyncHandlers(ipcMain, enrichedHandlers);
  registerFileHandlers(ipcMain, enrichedHandlers);
  registerPermissionHandlers(ipcMain, enrichedHandlers);
  registerMcpHandlers(ipcMain, enrichedHandlers);
  registerSystemHandlers(ipcMain, enrichedHandlers);
  registerPluginHandlers(ipcMain, enrichedHandlers);
  registerExtensionHandlers(ipcMain, enrichedHandlers);
  registerMemoryHandlers(ipcMain, enrichedHandlers);
  registerRagHandlers(ipcMain, enrichedHandlers);
  registerVoiceWorkflowHandlers(ipcMain, enrichedHandlers);
  registerAutofillHandlers(ipcMain, enrichedHandlers);


  console.log('[Handlers] All IPC handlers registered');
}

module.exports = { registerAllHandlers };
