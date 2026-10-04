const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

contextBridge.exposeInMainWorld('electronAPI', {
  // BrowserView related APIs
  getIsOnline: () => ipcRenderer.invoke('get-is-online'),
  getPlatform: () => ipcRenderer.invoke('get-platform'), // Use IPC for consistency
  isMicrosoftStore: () => ipcRenderer.invoke('is-microsoft-store'),
  getAppleIntelligenceStatus: () => ipcRenderer.invoke('apple-intelligence-status'),
  summarizeWithAppleIntelligence: (text) => ipcRenderer.invoke('apple-intelligence-summary', text),
  generateAppleIntelligenceImage: (payload) => ipcRenderer.invoke('apple-intelligence-generate-image', payload),
  generateGenmoji: (payload) => ipcRenderer.invoke('apple-intelligence-genmoji', payload),
  
  // Biometric Authentication
  checkBiometricAuth: () => ipcRenderer.invoke('biometric-check'),
  authenticateBiometric: (reason) => ipcRenderer.invoke('biometric-authenticate', reason),
  executeWithAuth: (actions, reason) => ipcRenderer.invoke('biometric-execute', actions, reason),
  onAddNewTab: (callback) => {
    const subscription = (event, url) => callback(url);
    ipcRenderer.on('add-new-tab', subscription);
    return () => ipcRenderer.removeListener('add-new-tab', subscription);
  },
  onSwitchTab: (callback) => {
    const subscription = (event, tabId) => callback(tabId);
    ipcRenderer.on('switch-tab', subscription);
    return () => ipcRenderer.removeListener('switch-tab', subscription);
  },
  onAiQueryDetected: (callback) => {
    const subscription = (event, query) => callback(query);
    ipcRenderer.on('ai-query-detected', subscription);
    return () => ipcRenderer.removeListener('ai-query-detected', subscription);
  },
  createView: (args) => ipcRenderer.send('create-view', args),
  addNewTab: (url) => ipcRenderer.send('create-view', { tabId: `tab-${Date.now()}`, url }),
  activateView: (args) => ipcRenderer.send('activate-view', args),
  hideAllViews: () => ipcRenderer.send('hide-all-views'),
  showAllViews: () => ipcRenderer.send('show-all-views'),
  destroyView: (tabId) => ipcRenderer.send('destroy-view', tabId),
  onBrowserViewUrlChanged: (callback) => {
    const subscription = (event, { tabId, url }) => callback({ tabId, url });
    ipcRenderer.on('browser-view-url-changed', subscription);
    return () => ipcRenderer.removeListener('browser-view-url-changed', subscription);
  },
  onBrowserViewTitleChanged: (callback) => {
    const subscription = (event, { tabId, title }) => callback({ tabId, title });
    ipcRenderer.on('browser-view-title-changed', subscription);
    return () => ipcRenderer.removeListener('browser-view-title-changed', subscription);
  },
  navigateTo: (url) => ipcRenderer.send('navigate-browser-view', { url }),
  navigateBrowserView: (args) => ipcRenderer.send('navigate-browser-view', args),
  goBack: () => ipcRenderer.send('browser-view-go-back'),
  goForward: () => ipcRenderer.send('browser-view-go-forward'),
  reload: () => ipcRenderer.send('browser-view-reload'),
  getCurrentUrl: () => ipcRenderer.invoke('get-browser-view-url'),
  getOpenTabs: () => ipcRenderer.invoke('get-open-tabs'),
  getTabMetadata: (tabId) => ipcRenderer.invoke('get-tab-metadata', tabId),
  getTabFavicon: (tabId) => ipcRenderer.invoke('get-tab-favicon', tabId),
  getTabLoadingStates: () => ipcRenderer.invoke('get-tab-loading-states'),
  extractPageContent: (tabId) => ipcRenderer.invoke('extract-page-content', tabId),
  extractSecureDOM: () => ipcRenderer.invoke('extract-secure-dom'),
  searchDOM: (query) => ipcRenderer.invoke('search-dom', query),
  getSelectedText: () => ipcRenderer.invoke('get-selected-text'),
  findAndClickText: (targetText) => ipcRenderer.invoke('find-and-click-text', targetText),
  setBrowserViewBounds: (bounds) => ipcRenderer.send('set-browser-view-bounds', bounds),
  setUserAgent: (userAgent) => ipcRenderer.invoke('set-user-agent', userAgent),
  setProxy: (config) => ipcRenderer.invoke('set-proxy', config),
  setNativeThemeSource: (source) => ipcRenderer.invoke('set-native-theme-source', source),
  getNetworkSecurityConfig: () => ipcRenderer.invoke('network-security-get'),
  updateNetworkSecurityConfig: (config) => ipcRenderer.invoke('network-security-update', config),
  capturePage: () => ipcRenderer.invoke('capture-page'),
  captureBrowserViewScreenshot: () => ipcRenderer.invoke('capture-browser-view-screenshot'),
  captureScreenRegion: (args) => ipcRenderer.invoke('capture-screen-region', args),
  sendInputEvent: (input) => ipcRenderer.invoke('send-input-event', input),
  openDevTools: () => ipcRenderer.send('open-dev-tools'),
  changeZoom: (deltaY) => ipcRenderer.send('change-zoom', deltaY),
  executeJavaScript: (code) => ipcRenderer.invoke('execute-javascript', code),
  clickElement: (selector) => ipcRenderer.invoke('click-element', selector),
  typeText: (selector, text) => ipcRenderer.invoke('type-text', { selector, text }),
  fillForm: (data) => ipcRenderer.invoke('fill-form', data),
  openExternalApp: (appNameOrPath) => ipcRenderer.invoke('open-external-app', appNameOrPath),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  searchApplications: (query) => ipcRenderer.invoke('search-applications', query),
  loadSkill: (skillId) => ipcRenderer.invoke('load-skill', skillId).then(r => {
    if (!r?.success) console.error('[loadSkill] IPC error for', skillId, r?.error || 'no content');
    return r?.success ? r.skill : '';
  }),
  getSuggestions: (query) => ipcRenderer.invoke('get-suggestions', query),
  onAudioStatusChanged: (callback) => {
    const subscription = (event, isPlaying) => callback(isPlaying);
    ipcRenderer.on('audio-status-changed', subscription);
    return () => ipcRenderer.removeListener('audio-status-changed', subscription);
  },
  onTabLoadingStatus: (callback) => {
    const subscription = (event, { tabId, isLoading }) => callback({ tabId, isLoading });
    ipcRenderer.on('tab-loading-status', subscription);
    return () => ipcRenderer.removeListener('tab-loading-status', subscription);
  },
  onWindowFullscreenChanged: (callback) => {
    const subscription = (event, isFullscreen) => callback(isFullscreen);
    ipcRenderer.on('window-fullscreen-changed', subscription);
    return () => ipcRenderer.removeListener('window-fullscreen-changed', subscription);
  },

  // Download Listeners
  onDownloadStarted: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('download-started', subscription);
    return () => ipcRenderer.removeListener('download-started', subscription);
  },
  onDownloadProgress: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('download-progress', subscription);
    return () => ipcRenderer.removeListener('download-progress', subscription);
  },
  onDownloadComplete: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('download-complete', subscription);
    return () => ipcRenderer.removeListener('download-complete', subscription);
  },
  onDownloadFailed: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('download-failed', subscription);
    return () => ipcRenderer.removeListener('download-failed', subscription);
  },
  onTabLoaded: (callback) => {
    const subscription = (event, { tabId, url }) => callback({ tabId, url });
    ipcRenderer.on('on-tab-loaded', subscription);
    return () => ipcRenderer.removeListener('on-tab-loaded', subscription);
  },

  // LLM & Memory APIs
  getAvailableLLMProviders: () => ipcRenderer.invoke('llm-get-available-providers'),
  getProviderModels: (providerId, options) => ipcRenderer.invoke('llm-get-provider-models', providerId, options),
  setActiveLLMProvider: (providerId) => ipcRenderer.invoke('llm-set-active-provider', providerId),
  configureLLMProvider: (providerId, options) => ipcRenderer.invoke('llm-configure-provider', providerId, options),
  getStoredApiKeys: () => ipcRenderer.invoke('get-stored-api-keys'),
  getAISettings: (category) => ipcRenderer.invoke('get-ai-settings', category),
  updateAISettings: (category, updates) => ipcRenderer.invoke('update-ai-settings', category, updates),
  triggerShortcut: (action) => ipcRenderer.invoke('trigger-shortcut', action),
  getOnboardingState: () => ipcRenderer.invoke('get-onboarding-state'),
  setOnboardingState: (partial) => ipcRenderer.invoke('set-onboarding-state', partial),
  generateChatContent: (messages, options) => ipcRenderer.invoke('llm-generate-chat-content', messages, options),
  streamChatContent: (messages, options) => {
    ipcRenderer.send('llm-stream-chat-content', messages, options);
  },
  onChatStreamPart: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('llm-chat-stream-part', subscription);
    return () => ipcRenderer.removeListener('llm-chat-stream-part', subscription);
  },
  getAiMemory: () => ipcRenderer.invoke('get-ai-memory'),
  addAiMemory: (entry) => ipcRenderer.send('add-ai-memory', entry),
  saveVectorStore: (data) => ipcRenderer.invoke('save-vector-store', data),
   loadVectorStore: () => ipcRenderer.invoke('load-vector-store'),
   clearVectorStore: () => ipcRenderer.invoke('clear-vector-store'),
  saveGoogleConfig: (config) => ipcRenderer.send('save-google-config', config),
  getGoogleConfig: () => ipcRenderer.invoke('get-google-config'),
  webSearchRag: (query) => ipcRenderer.invoke('web-search-rag', query),
  aiWebSearch: (query, engine, count) => ipcRenderer.invoke('ai-web-search', query, engine, count),
  webSearch: (query, provider, count) => ipcRenderer.invoke('web-search', query, provider, count),
  webSearchContext: (query, provider) => ipcRenderer.invoke('web-search-context', query, provider),
  webSearchProviders: () => ipcRenderer.invoke('web-search-providers'),
  webSearchConfigure: (keys) => ipcRenderer.invoke('web-search-configure', keys),
  fetchPageContent: (url, maxChars) => ipcRenderer.invoke('fetch-page-content', url, maxChars),
  webSearchYoutube: (query, count) => ipcRenderer.invoke('web-search-youtube', query, count),

  // Research jobs stream `research-progress` back as they run; the returned
  // function unsubscribes, matching `onChatStreamPart`.
  runResearch: (payload) => ipcRenderer.invoke('research-run', payload),
  onResearchProgress: (callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('research-progress', subscription);
    return () => ipcRenderer.removeListener('research-progress', subscription);
  },

  domClickElement: (opts) => ipcRenderer.invoke('dom-click-element', opts),
  domFillForm: (opts) => ipcRenderer.invoke('dom-fill-form', opts),
  multiFillForm: (opts) => ipcRenderer.invoke('dom-multi-fill-form', opts),
  domEngineFind: (opts) => ipcRenderer.invoke('dom-engine-find', opts),
  domCdpClick: (opts) => ipcRenderer.invoke('dom-cdp-click', opts),
  domGetAccessibilityTree: (opts) => ipcRenderer.invoke('dom-get-accessibility-tree', opts),
  domGetClickableElements: (opts) => ipcRenderer.invoke('dom-get-clickable-elements', opts),
  vaultListEntries: () => ipcRenderer.invoke('vault-list-entries'),
  vaultSaveEntry: (entry) => ipcRenderer.invoke('vault-save-entry', entry),
  vaultDeleteEntry: (entryId) => ipcRenderer.invoke('vault-delete-entry', entryId),
  vaultReadSecret: (entryId) => ipcRenderer.invoke('vault-read-secret', entryId),
  vaultCopySecret: (entryId) => ipcRenderer.invoke('vault-copy-secret', entryId),
  vaultCheckMigration: () => ipcRenderer.invoke('vault-check-migration'),
  vaultMigrateToModern: () => ipcRenderer.invoke('vault-migrate-to-modern'),
  vaultGenerateTotp: (entryId) => ipcRenderer.invoke('vault-generate-totp', entryId),
  vaultSaveTotpSecret: (entryId, totpSecret) => ipcRenderer.invoke('vault-save-totp-secret', entryId, totpSecret),
  vaultRemoveTotpSecret: (entryId) => ipcRenderer.invoke('vault-remove-totp-secret', entryId),
  vaultReadAuditLog: (limit) => ipcRenderer.invoke('vault-read-audit-log', limit),
  extractSearchResults: (tabId) => ipcRenderer.invoke('extract-search-results', tabId),
  translateWebsite: (args) => ipcRenderer.invoke('translate-website', args),
  translateText: (args) => ipcRenderer.invoke('translate-text', args),
  onTriggerTranslationDialog: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('trigger-translation-dialog', subscription);
    return () => ipcRenderer.removeListener('trigger-translation-dialog', subscription);
  },
  onAutomationShellApproval: (callback) => {
    const subscription = (event, payload) => callback(payload);
    ipcRenderer.on('automation-shell-approval', subscription);
    return () => ipcRenderer.removeListener('automation-shell-approval', subscription);
  },
  respondAutomationShellApproval: (response) => ipcRenderer.send('automation-shell-approval-response', response),

  // Auth
  openAuthWindow: (url) => ipcRenderer.send('open-auth-window', url),
  closeAuthWindow: () => ipcRenderer.send('close-auth-window'),
  onAuthCallback: (callback) => {
    const subscription = (event, url) => callback(event, url);
    ipcRenderer.on('auth-callback', subscription);
    return () => ipcRenderer.removeListener('auth-callback', subscription);
  },
  onAuthTokenReceived: (callback) => {
    const subscription = (event, token) => callback(token);
    ipcRenderer.on('auth-token-received', subscription);
    return () => ipcRenderer.removeListener('auth-token-received', subscription);
  },

  // Auto-configure Claude Desktop MCP
  autoConfigureClaudeMcp: () => ipcRenderer.invoke('auto-configure-claude-mcp'),

  // Popups
  openSettingsPopup: (section) => ipcRenderer.send('open-settings-popup', section),
  openProfilePopup: () => ipcRenderer.send('open-profile-popup'),
  openPluginsPopup: () => ipcRenderer.send('open-plugins-popup'),
  openPopupWindow: (type, options) => ipcRenderer.send('open-popup-window', { type, options }),
  closePopupWindow: (type) => ipcRenderer.send('close-popup-window', type),
  closeAllPopups: () => ipcRenderer.send('close-all-popups'),
  onLoadAuthToken: (callback) => {
    const subscription = (event, token) => callback(token);
    ipcRenderer.on('load-auth-token', subscription);
    return () => ipcRenderer.removeListener('load-auth-token', subscription);
  },
  onLoadAuthSession: (callback) => {
    const subscription = (event, session) => callback(session);
    ipcRenderer.on('load-auth-session', subscription);
    return () => ipcRenderer.removeListener('load-auth-session', subscription);
  },
  saveAuthToken: (args) => ipcRenderer.send('save-auth-token', args),
  saveAuthSession: (session) => ipcRenderer.send('save-auth-session', session),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
  getAuthSession: () => ipcRenderer.invoke('get-auth-session'),
  getUserInfo: () => ipcRenderer.invoke('get-user-info'),
  clearAuth: () => ipcRenderer.send('clear-auth'),

  // Gmail API
  testGeminiApi: (apiKey) => ipcRenderer.invoke('test-gemini-api', apiKey),
  gmailAuthorize: () => ipcRenderer.invoke('gmail-authorize'),
  gmailListMessages: (query, maxResults) => ipcRenderer.invoke('gmail-list-messages', query, maxResults),
  gmailGetMessage: (messageId) => ipcRenderer.invoke('gmail-get-message', messageId),
  gmailSendMessage: (to, subject, body, threadId) => ipcRenderer.invoke('gmail-send-message', to, subject, body, threadId),
  gmailAddLabelToMessage: (messageId, labelName) => ipcRenderer.invoke('gmail-add-label-to-message', messageId, labelName),
  onGmailOAuthCode: (callback) => {
    const subscription = (event, code) => callback(code);
    ipcRenderer.on('gmail-oauth-code', subscription);
    return () => ipcRenderer.removeListener('gmail-oauth-code', subscription);
  },

  // Dev-MCP & Analytics
  sendMcpCommand: (command, data) => ipcRenderer.invoke('mcp-command', { command, data }),
  shareDeviceFolder: () => ipcRenderer.invoke('share-device-folder'),
  capturePageHtml: () => ipcRenderer.invoke('capture-page-html'),
  saveOfflinePage: (data) => ipcRenderer.invoke('save-offline-page', data),
  generatePDF: (title, content) => ipcRenderer.invoke('generate-pdf', title, content),
  generatePDFWithMethod: (method, options) => ipcRenderer.invoke('generate-pdf-with-method', { method, options }),
  generatePPTX: (payload) => ipcRenderer.invoke('generate-pptx', payload),
  generateDOCX: (payload) => ipcRenderer.invoke('generate-docx', payload),
  generateXLSX: (payload) => ipcRenderer.invoke('generate-xlsx', payload),
  openPDF: (filePath) => ipcRenderer.invoke('open-pdf', filePath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  checkPythonAvailable: () => ipcRenderer.invoke('check-python-available'),

  // Utils
  setUserId: (userId) => ipcRenderer.send('set-user-id', userId),
  getClipboardText: () => ipcRenderer.invoke('get-clipboard-text'),
  setClipboardText: (text) => ipcRenderer.send('set-clipboard-text', text),

  // Extension & File Utils
  getExtensionPath: () => ipcRenderer.invoke('get-extension-path'),
  getIconPath: () => ipcRenderer.invoke('get-icon-path'),
  getExtensions: () => ipcRenderer.invoke('get-extensions'),
  toggleExtension: (id) => ipcRenderer.invoke('toggle-extension', id),
  uninstallExtension: (id) => ipcRenderer.invoke('uninstall-extension', id),
  openExtensionDir: () => ipcRenderer.send('open-extension-dir'),
  installExtensionFolder: (folderPath) => ipcRenderer.invoke('install-extension-folder', folderPath),
  installExtensionCRX: (crxPath) => ipcRenderer.invoke('install-extension-crx', crxPath),
  enableExtension: (id) => ipcRenderer.invoke('enable-extension', id),
  disableExtension: (id) => ipcRenderer.invoke('disable-extension', id),
  selectAndInstallExtension: () => ipcRenderer.invoke('select-and-install-extension'),
  onExtensionInstalled: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('extension-installed', subscription);
    return () => ipcRenderer.removeListener('extension-installed', subscription);
  },
  onExtensionRemoved: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('extension-removed', subscription);
    return () => ipcRenderer.removeListener('extension-removed', subscription);
  },
  onExtensionUpdated: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('extension-updated', subscription);
    return () => ipcRenderer.removeListener('extension-updated', subscription);
  },
  getExtensionActions: () => ipcRenderer.invoke('get-extension-actions'),
  openExtensionPopup: (extensionId) => ipcRenderer.invoke('open-extension-popup', extensionId),
  closeExtensionPopup: () => ipcRenderer.send('close-extension-popup'),
  onExtensionActionUpdated: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('extension-action-updated', subscription);
    return () => ipcRenderer.removeListener('extension-action-updated', subscription);
  },
  // Autofill Profile Service
  autofillList: () => ipcRenderer.invoke('autofill:list'),
  autofillGet: (id) => ipcRenderer.invoke('autofill:get', id),
  autofillAdd: (profile) => ipcRenderer.invoke('autofill:add', profile),
  autofillUpdate: (id, updates) => ipcRenderer.invoke('autofill:update', id, updates),
  autofillDelete: (id) => ipcRenderer.invoke('autofill:delete', id),
  autofillDetect: () => ipcRenderer.invoke('autofill:detect'),
  autofillFill: (profileId) => ipcRenderer.invoke('autofill:fill', profileId),
  toggleAdblocker: (enable) => ipcRenderer.send('toggle-adblocker', enable),

  // Window Controls
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  setAsDefaultBrowser: () => ipcRenderer.invoke('set-as-default-browser'),
  hideWebview: () => ipcRenderer.send('hide-webview'),
  showWebview: () => ipcRenderer.send('show-webview'),
  createDesktopShortcut: (args) => ipcRenderer.invoke('create-desktop-shortcut', args),

  // Chat & File Export
  exportChatAsTxt: (messages) => ipcRenderer.invoke('export-chat-txt', messages),
  exportChatAsPdf: (messages) => ipcRenderer.invoke('export-chat-pdf', messages),

  // Database & Sync
  initDatabase: (config) => ipcRenderer.invoke('init-database', config),
  syncData: (params) => ipcRenderer.invoke('sync-data', params),

  // P2P File Sync
  scanFolder: (path, types) => ipcRenderer.invoke('scan-folder', { path, types }),
  classifyTabsAi: (args) => ipcRenderer.invoke('classify-tabs-ai', args),
  organizeFolder: (path) => ipcRenderer.invoke('organize-folder', path),

  // Phone Control
  sendPhoneCommand: (command, data) => ipcRenderer.invoke('send-phone-command', { command, data }),

  // Contacts
  getDeviceContacts: () => ipcRenderer.invoke('get-device-contacts'),
  syncContacts: (deviceId, contacts) => ipcRenderer.invoke('sync-contacts', { deviceId, contacts }),

  // OTP
  startSMSListener: () => ipcRenderer.invoke('start-sms-listener'),
  startEmailListener: () => ipcRenderer.invoke('start-email-listener'),
  syncOTP: (otp) => ipcRenderer.invoke('sync-otp', otp),
  requestSMSPermission: () => ipcRenderer.invoke('request-sms-permission'),
  onShortcut: (callback) => {
    const subscription = (event, action) => callback(action);
    ipcRenderer.on('execute-shortcut', subscription);
    return () => ipcRenderer.removeListener('execute-shortcut', subscription);
  },
  updateShortcuts: (shortcuts) => ipcRenderer.send('update-shortcuts', shortcuts),
  setAlarm: (time, message) => ipcRenderer.invoke('set-alarm', { time, message }),

  // Tab Optimization APIs
  suspendTab: (tabId) => ipcRenderer.send('suspend-tab', tabId),
  resumeTab: (args) => ipcRenderer.send('resume-tab', args),
  onTabSuspended: (callback) => {
    const subscription = (event, tabId) => callback(tabId);
    ipcRenderer.on('tab-suspended', subscription);
    return () => ipcRenderer.removeListener('tab-suspended', subscription);
  },
  onTabResumed: (callback) => {
    const subscription = (event, tabId) => callback(tabId);
    ipcRenderer.on('tab-resumed', subscription);
    return () => ipcRenderer.removeListener('tab-resumed', subscription);
  },
  onResumeTabAndActivate: (callback) => {
    const subscription = (event, tabId) => callback(tabId);
    ipcRenderer.on('resume-tab-and-activate', subscription);
    return () => ipcRenderer.removeListener('resume-tab-and-activate', subscription);
  },
  getMemoryUsage: () => ipcRenderer.invoke('get-memory-usage'),
  popSearchShow: (text, x, y) => ipcRenderer.invoke('pop-search-show', { text, x, y }),
  popSearchShowAtCursor: (text) => ipcRenderer.invoke('pop-search-show-at-cursor', text),
  popSearchGetConfig: () => ipcRenderer.invoke('pop-search-get-config'),
  popSearchUpdateConfig: (config) => ipcRenderer.invoke('pop-search-update-config', config),
  popSearchSaveConfig: (data) => ipcRenderer.invoke('pop-search-save-config', data),
  popSearchLoadConfig: () => ipcRenderer.invoke('pop-search-load-config'),
  pullOllamaModel: (model, callback) => {
    ipcRenderer.send('ollama-pull-model', model);
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('ollama-pull-progress', subscription);
    return () => ipcRenderer.removeListener('ollama-pull-progress', subscription);
  },

  importOllamaModel: (data) => ipcRenderer.invoke('ollama-import-model', data),
  selectLocalFile: (options) => ipcRenderer.invoke('select-local-file', options),
  triggerDownload: (url, filename) => ipcRenderer.invoke('trigger-download', url, filename),
  setMcpServerPort: (port) => ipcRenderer.send('set-mcp-server-port', port),
  sendToAIChatInput: (text) => ipcRenderer.send('send-to-ai-chat-input', text),
  ollamaListModels: () => ipcRenderer.invoke('ollama-list-models'),
  connectToRemoteDevice: (remoteDeviceId) => ipcRenderer.invoke('connect-to-remote-device', remoteDeviceId),
  sendP2PSignal: (signal, remoteDeviceId) => ipcRenderer.send('send-p2p-signal', { signal, remoteDeviceId }),

  onP2PConnected: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('p2p-connected', subscription);
    return () => ipcRenderer.removeListener('p2p-connected', subscription);
  },
  onP2PDisconnected: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('p2p-disconnected', subscription);
    return () => ipcRenderer.removeListener('p2p-disconnected', subscription);
  },
  onP2PFirebaseReady: (callback) => {
    const subscription = (event, userId) => callback(userId);
    ipcRenderer.on('p2p-firebase-ready', subscription);
    return () => ipcRenderer.removeListener('p2p-firebase-ready', subscription);
  },
  onP2POfferCreated: (callback) => {
    const subscription = (event, { offer, remoteDeviceId }) => callback({ offer, remoteDeviceId });
    ipcRenderer.on('p2p-offer-created', subscription);
    return () => ipcRenderer.removeListener('p2p-offer-created', subscription);
  },
  onP2PAnswerCreated: (callback) => {
    const subscription = (event, { answer, remoteDeviceId }) => callback({ answer, remoteDeviceId });
    ipcRenderer.on('p2p-answer-created', subscription);
    return () => ipcRenderer.removeListener('p2p-answer-created', subscription);
  },
  onP2PIceCandidate: (callback) => {
    const subscription = (event, { candidate, remoteDeviceId }) => callback({ candidate, remoteDeviceId });
    ipcRenderer.on('p2p-ice-candidate', subscription);
    return () => ipcRenderer.removeListener('p2p-ice-candidate', subscription);
  },
  onP2PLocalDeviceId: (callback) => {
    const subscription = (event, deviceId) => callback(deviceId);
    ipcRenderer.on('p2p-local-device-id', subscription);
    return () => ipcRenderer.removeListener('p2p-local-device-id', subscription);
  },
  onP2PMessage: (callback) => {
    const subscription = (event, message) => callback(message);
    ipcRenderer.on('p2p-message', subscription);
    return () => ipcRenderer.removeListener('p2p-message', subscription);
  },
  getP2PLocalDeviceId: () => ipcRenderer.invoke('p2p-get-device-id'),
  on: (channel, callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  saveAiResponse: (content) => ipcRenderer.send('save-ai-response', content),

  // Persistent Storage APIs for user data
  savePersistentData: (key, data) => ipcRenderer.invoke('save-persistent-data', { key, data }),
  loadPersistentData: (key) => ipcRenderer.invoke('load-persistent-data', key),
  deletePersistentData: (key) => ipcRenderer.invoke('delete-persistent-data', key),
  getMacNativeUIPreferences: () => ipcRenderer.invoke('get-mac-native-ui-preferences'),
  setMacNativeUIPreferences: (preferences) => ipcRenderer.invoke('set-mac-native-ui-preferences', preferences),
  showMacNativePanel: (mode) => ipcRenderer.invoke('show-mac-native-panel', mode),
  toggleMacNativePanel: (mode) => ipcRenderer.invoke('toggle-mac-native-panel', mode),
  updateNativeMacUIState: (state) => ipcRenderer.send('update-native-mac-ui-state', state),
  onMacNativeUIPreferencesChanged: (callback) => {
    const subscription = (event, preferences) => callback(preferences);
    ipcRenderer.on('mac-native-ui-preferences-changed', subscription);
    return () => ipcRenderer.removeListener('mac-native-ui-preferences-changed', subscription);
  },
  onNativeMacPrompt: (callback) => {
    const subscription = (event, payload) => callback(payload);
    ipcRenderer.on('native-mac-ui-submit-prompt', subscription);
    return () => ipcRenderer.removeListener('native-mac-ui-submit-prompt', subscription);
  },
  notifyAiSidebarOpen: () => ipcRenderer.send('native-mac-ui-sidebar-open'),
  notifyAiSidebarClosed: () => ipcRenderer.send('native-mac-ui-sidebar-closed'),
  notifyApprovalPending: (details) => ipcRenderer.send('ui-approval-pending', details),
  notifyApprovalCleared: () => ipcRenderer.send('ui-approval-cleared'),
  onApprovalActionResolved: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('approval-action-resolved', subscription);
    return () => ipcRenderer.removeListener('approval-action-resolved', subscription);
  },
  onAIChatInputText: (callback) => {
    const subscription = (event, text) => callback(text);
    ipcRenderer.on('ai-chat-input-text', subscription);
    return () => ipcRenderer.removeListener('ai-chat-input-text', subscription);
  },
  onAiChatInputText: (callback) => {
    const subscription = (event, text) => callback(text);
    ipcRenderer.on('ai-chat-input-text', subscription);
    return () => ipcRenderer.removeListener('ai-chat-input-text', subscription);
  },

  // Network status
  onNetworkStatusChanged: (callback) => {
    const subscription = (event, isOnline) => callback(isOnline);
    ipcRenderer.on('network-status-changed', subscription);
    return () => ipcRenderer.removeListener('network-status-changed', subscription);
  },

  // Clipboard monitoring
  onClipboardChanged: (callback) => {
    const subscription = (event, text) => callback(text);
    ipcRenderer.on('clipboard-changed', subscription);
    return () => ipcRenderer.removeListener('clipboard-changed', subscription);
  },

  // Popup Window System
  openPopupWindow: (type, options) => ipcRenderer.send('open-popup-window', { type, options }),
  closePopupWindow: (type) => ipcRenderer.send('close-popup-window', type),
  closeAllPopups: () => ipcRenderer.send('close-all-popups'),

  // Specific popup handlers
  openSettingsPopup: (section) => ipcRenderer.send('open-settings-popup', section),
  openProfilePopup: () => ipcRenderer.send('open-profile-popup'),
  openPluginsPopup: () => ipcRenderer.send('open-plugins-popup'),
  openDownloadsPopup: () => ipcRenderer.send('open-downloads-popup'),
  openClipboardPopup: () => ipcRenderer.send('open-clipboard-popup'),
  openCartPopup: () => ipcRenderer.send('open-cart-popup'),
  openSearchPopup: (options) => ipcRenderer.send('open-search-popup', options),
  openTranslatePopup: (options) => ipcRenderer.send('open-translate-popup', options),
  openContextMenuPopup: (options) => ipcRenderer.send('open-context-menu-popup', options),
  onMcpApprovalPending: (callback) => {
    const subscription = (event, details) => callback(details);
    ipcRenderer.on('mcp-approval-pending', subscription);
    return () => ipcRenderer.removeListener('mcp-approval-pending', subscription);
  },
  mcpApprovalRespond: (requestId, allowed) => ipcRenderer.invoke('mcp-approval-respond', { requestId, allowed }),
  mcpApprovalStatus: () => ipcRenderer.invoke('mcp-approval-status'),

  // Google OAuth Integration
  googleOAuthLogin: () => ipcRenderer.send('google-oauth-login'),
  onGoogleOAuthCode: (callback) => {
    const subscription = (event, code) => callback(code);
    ipcRenderer.on('google-oauth-code', subscription);
    return () => ipcRenderer.removeListener('google-oauth-code', subscription);
  },

  // Shell Command Execution
  executeShellCommand: (arg1, arg2 = false) => {
    if (typeof arg1 === 'object' && arg1 !== null) {
      return ipcRenderer.invoke('execute-shell-command', arg1);
    }
    return ipcRenderer.invoke('execute-shell-command', { rawCommand: arg1, preApproved: arg2 });
  },
  setVolume: (level) => ipcRenderer.invoke('set-volume', level),
  setBrightness: (level) => ipcRenderer.invoke('set-brightness', level),
  setBrowserFont: (fontFamily, fontSize) => ipcRenderer.invoke('set-browser-font', { fontFamily, fontSize }),

  // System Settings
  openSystemSettings: (url) => ipcRenderer.invoke('open-system-settings', url),
  updateRaycastState: (state) => ipcRenderer.send('raycast-update-state', state),

  // Cross-App Control APIs
  captureScreenRegion: (region) => ipcRenderer.invoke('capture-screen-region', region),
  performCrossAppClick: (coords) => ipcRenderer.invoke('perform-click', coords),
  performClick: (options) => ipcRenderer.invoke('perform-click', options),
  clickAt: (x, y) => ipcRenderer.invoke('perform-click', { x, y }),
  typeText: (text) => ipcRenderer.invoke('type-text-app', text),
  clickAppElement: (appName, elementText, reason) => ipcRenderer.invoke('click-app-element', { appName, elementText, reason }),
  typeTextApp: (text) => ipcRenderer.invoke('type-text-app', text),
  performOCR: (options) => ipcRenderer.invoke('perform-ocr', options),
  getWindowInfo: () => ipcRenderer.invoke('get-window-info'),

  // Unified Search Event Listener
  onOpenUnifiedSearch: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('open-unified-search', subscription);
    return () => ipcRenderer.removeListener('open-unified-search', subscription);
  },

  // WiFi Sync
  getAutofillData: (domain) => ipcRenderer.invoke('get-autofill-data', domain),
  getWifiSyncQr: (cloudMode) => ipcRenderer.invoke('get-wifi-sync-qr', cloudMode),
  getWifiSyncInfo: () => ipcRenderer.invoke('get-wifi-sync-info'),
  getWifiSyncDevices: () => ipcRenderer.invoke('get-wifi-sync-devices'),
  setWifiSyncDeviceTrust: (payload) => ipcRenderer.invoke('set-wifi-sync-device-trust', payload),
  removeWifiSyncDevice: (deviceId) => ipcRenderer.invoke('remove-wifi-sync-device', deviceId),
  onWifiSyncStatus: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('wifi-sync-status', subscription);
    return () => ipcRenderer.removeListener('wifi-sync-status', subscription);
  },
  onWifiSyncDevicesUpdated: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('wifi-sync-devices-updated', subscription);
    return () => ipcRenderer.removeListener('wifi-sync-devices-updated', subscription);
  },
  onRemoteAiPrompt: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('remote-ai-prompt', subscription);
    return () => ipcRenderer.removeListener('remote-ai-prompt', subscription);
  },

  // Cloud Sync
  loginToCloud: (email, password) => ipcRenderer.invoke('login-to-cloud', email, password),
  logoutFromCloud: () => ipcRenderer.invoke('logout-from-cloud'),
  saveCloudConfig: (provider, config) => ipcRenderer.invoke('save-cloud-config', provider, config),
  getCloudDevices: () => ipcRenderer.invoke('get-cloud-devices'),
  connectToCloudDevice: (deviceId) => ipcRenderer.invoke('connect-to-cloud-device', deviceId),
  disconnectFromCloudDevice: (deviceId) => ipcRenderer.invoke('disconnect-from-cloud-device', deviceId),
  syncClipboard: (text) => ipcRenderer.invoke('sync-clipboard', text),
  syncHistory: (history) => ipcRenderer.invoke('sync-history', history),
  sendDesktopControl: (targetDeviceId, action, args) => ipcRenderer.invoke('send-desktop-control', targetDeviceId, action, args),
  proposePasswordSave: (data) => ipcRenderer.send('propose-password-save', data),
  onShowPasswordSaveDialog: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('show-password-save-dialog', subscription);
    return () => ipcRenderer.removeListener('show-password-save-dialog', subscription);
  },
  onCloudSyncStatus: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('cloud-sync-status', subscription);
    return () => ipcRenderer.removeListener('cloud-sync-status', subscription);
  },

  // v2 Automation APIs
  permGrant: (key, level, description, sessionOnly) =>
    ipcRenderer.invoke('perm-grant', { key, level, description, sessionOnly }),
  permRevoke: (key) => ipcRenderer.invoke('perm-revoke', key),
  permRevokeAll: () => ipcRenderer.invoke('perm-revoke-all'),
  permCheck: (key) => ipcRenderer.invoke('perm-check', key),
  permList: () => ipcRenderer.invoke('perm-list'),
  permAuditLog: (limit) => ipcRenderer.invoke('perm-audit-log', limit),
  getSecuritySettings: () => ipcRenderer.invoke('security-settings-get'),
  updateSecuritySettings: (settings) => ipcRenderer.invoke('security-settings-update', settings),
  setAutoApprovalCommand: (payload) => ipcRenderer.invoke('permission-auto-command', payload),
  getAutoApprovedCommands: () => ipcRenderer.invoke('permission-auto-commands'),
  setAutoApprovalAction: (payload) => ipcRenderer.invoke('permission-auto-action', payload),
  getAutoApprovedActions: () => ipcRenderer.invoke('permission-auto-actions'),

  // Directory Allowlist
  getDirectoryAllowlist: () => ipcRenderer.invoke('directory-allowlist-get'),
  addDirectoryToAllowlist: (dirPath, options) => ipcRenderer.invoke('directory-allowlist-add', { dirPath, ...options }),
  removeDirectoryFromAllowlist: (dirPath) => ipcRenderer.invoke('directory-allowlist-remove', { dirPath }),

  // Directory permission request panel — fired by main when a blocked path is encountered
  onDirectoryPermissionRequest: (callback) => {
    const subscription = (event, payload) => callback(payload);
    ipcRenderer.on('directory-permission-request', subscription);
    return () => ipcRenderer.removeListener('directory-permission-request', subscription);
  },
  respondDirectoryPermission: (requestId, granted) =>
    ipcRenderer.send('directory-permission-response', { requestId, granted }),

  // Shell permission approval prompt bridge — fired by main when unauthorized shell command is executed
  onShellPermissionRequest: (callback) => {
    const subscription = (event, payload) => callback(payload);
    ipcRenderer.on('shell-permission-request', subscription);
    return () => ipcRenderer.removeListener('shell-permission-request', subscription);
  },
  respondShellPermission: (requestId, granted, remember = false) =>
    ipcRenderer.send('shell-permission-response', { requestId, granted, remember }),

  // CLI Token Management
  getCliToken: () => ipcRenderer.invoke('get-cli-token'),
  regenerateCliToken: () => ipcRenderer.invoke('regenerate-cli-token'),
  
  // File Management (routes around shell sandbox)
  moveFile: (source, dest) => ipcRenderer.invoke('file-move', { source, dest }),
  copyFile: (source, dest) => ipcRenderer.invoke('file-copy', { source, dest }),
  openFile: (filePath) => ipcRenderer.invoke('file-open', filePath),
  printFile: (filePath) => ipcRenderer.invoke('file-print', filePath),
  checkFileAccess: (filePath, operation) => ipcRenderer.invoke('file-check-access', { filePath, operation }),
  
  // Batched directory access request
  requestDirectoryAccess: (requests) => ipcRenderer.invoke('request-directory-access', { requests }),
  
  // Ticket-based approval system (prevents param tampering)
  approveTicket: (ticketId) => ipcRenderer.invoke('approval-ticket-approve', ticketId),
  denyTicket: (ticketId, reason) => ipcRenderer.invoke('approval-ticket-deny', ticketId, reason),
  getTicketStatus: (ticketId) => ipcRenderer.invoke('approval-ticket-status', ticketId),
  getPendingApprovals: () => ipcRenderer.invoke('approval-ticket-pending'),
  
  // Listen for approval required events from main
  onApprovalRequired: (callback) => {
    const subscription = (event, ticket) => callback(ticket);
    ipcRenderer.on('approval-required', subscription);
    return () => ipcRenderer.removeListener('approval-required', subscription);
  },
  
  // Approval statistics
  getApprovalStats: () => ipcRenderer.invoke('approval-ticket-stats'),
  
  // Unattended execution (for scheduled tasks)
  registerCallShape: (actionName, params, metadata) => 
    ipcRenderer.invoke('approval-register-call-shape', { actionName, params, metadata }),
  registerCallShapePattern: (actionName, paramPatterns, metadata) => 
    ipcRenderer.invoke('approval-register-call-pattern', { actionName, paramPatterns, metadata }),
  executeUnattended: (actionName, params) => 
    ipcRenderer.invoke('approval-execute-unattended', { actionName, params }),
  getCallShapes: (actionName) => ipcRenderer.invoke('approval-get-call-shapes', actionName),
  revokeCallShape: (shapeId) => ipcRenderer.invoke('approval-revoke-call-shape', shapeId),
  
  generateHighRiskQr: (actionId) => ipcRenderer.invoke('generate-high-risk-qr', actionId),
  onMobileApproveHighRisk: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('mobile-approve-high-risk', subscription);
    return () => ipcRenderer.removeListener('mobile-approve-high-risk', subscription);
  },
  submitShellApprovalResponse: (requestId, allowed, deviceUnlockValidated = false) =>
    ipcRenderer.send('automation-shell-approval-response', { requestId, allowed, deviceUnlockValidated }),

  forwardAiStream: (opts) => ipcRenderer.invoke('forward-ai-stream', opts),

  robotExecute: (action) => ipcRenderer.invoke('robot-execute', action),
  robotExecuteSequence: (actions, options) =>
    ipcRenderer.invoke('robot-execute-sequence', { actions, options }),

  ocrScreenText: (displayId) => ipcRenderer.invoke('ocr-screen-text', displayId),
  ocrCaptureWords: (displayId) => ipcRenderer.invoke('ocr-capture-words', displayId),
  ocrClick: (target, useAi) => ipcRenderer.invoke('ocr-click', { target, useAi }),

  visionDescribe: (question) => ipcRenderer.invoke('vision-describe', question),
  visionAnalyze: (question) => ipcRenderer.invoke('vision-analyze', question),

  aiEngineChat: (opts) => ipcRenderer.invoke('ai-engine-chat', opts),
  classifyTabsAi: (args) => ipcRenderer.invoke('classify-tabs-ai', args),
  organizeFolder: (path) => ipcRenderer.invoke('organize-folder', path),

  mcpFsRead: (filePath) => ipcRenderer.invoke('mcp-fs-read', filePath),
  mcpFsWrite: (filePath, content) => ipcRenderer.invoke('mcp-fs-write', { path: filePath, content }),
  mcpFsList: (dirPath) => ipcRenderer.invoke('mcp-fs-list', dirPath),

  // Scheduling & Automation
  scheduleTask: (taskData) => ipcRenderer.invoke('automation:create-task', taskData),
  getScheduledTasks: () => ipcRenderer.invoke('automation:get-tasks'),
  updateScheduledTask: (taskId, updates) => ipcRenderer.invoke('automation:update-task', taskId, updates),
  deleteScheduledTask: (taskId) => ipcRenderer.invoke('automation:delete-task', taskId),
  toggleScheduledTask: (taskId) => ipcRenderer.invoke('automation:toggle-task', taskId),
  runScheduledTask: (taskId) => ipcRenderer.invoke('automation:run-task', taskId),
  getTaskLogs: (date) => ipcRenderer.invoke('automation:get-logs', date),
  enableCLI: () => ipcRenderer.invoke('automation:enable-cli'),
  checkCLIStatus: () => ipcRenderer.invoke('automation:check-cli-status'),
  disableCLI: () => ipcRenderer.invoke('automation:disable-cli'),
  getServiceStatus: () => ipcRenderer.invoke('automation:get-service-status'),
  installService: (options) => ipcRenderer.invoke('automation:install-background-service', options),
  uninstallService: (options) => ipcRenderer.invoke('automation:uninstall-background-service', options),

  // Workflow Recording/Playback
  workflowStartRecording: (opts) => ipcRenderer.invoke('workflow-start', opts),
  workflowRecordStep: (step) => ipcRenderer.invoke('workflow-record', step),
  workflowRecordDomStep: (step) => ipcRenderer.invoke('workflow-record-dom-step', step),
  workflowStopRecording: () => ipcRenderer.invoke('workflow-stop'),
  workflowSave: (opts) => ipcRenderer.invoke('workflow-save', opts),
  workflowList: () => ipcRenderer.invoke('workflow-list'),
  workflowReplay: (name) => ipcRenderer.invoke('workflow-replay', name),
  workflowDelete: (name) => ipcRenderer.invoke('workflow-delete', name),
  workflowStatus: () => ipcRenderer.invoke('workflow-status'),

  // Unified App Icon API
  getAppIcon: (appPath) => {
    if (appPath) return ipcRenderer.invoke('get-app-icon', appPath);
    return ipcRenderer.invoke('get-app-icon-base64');
  },
  getAartiqIcon: () => ipcRenderer.invoke('get-app-icon-base64'),
  
  getVersion: () => ipcRenderer.invoke('get-app-version'),

  // Plugin System APIs
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    get: (pluginId) => ipcRenderer.invoke('plugins:get', pluginId),
    install: (source, options) => ipcRenderer.invoke('plugins:install', source, options),
    uninstall: (pluginId) => ipcRenderer.invoke('plugins:uninstall', pluginId),
    update: (pluginId) => ipcRenderer.invoke('plugins:update', pluginId),
    enable: (pluginId) => ipcRenderer.invoke('plugins:enable', pluginId),
    disable: (pluginId) => ipcRenderer.invoke('plugins:disable', pluginId),
    getCommands: () => ipcRenderer.invoke('plugins:get-commands'),
    executeCommand: (commandId, params) => ipcRenderer.invoke('plugins:execute-command', commandId, params),
    updateConfig: (pluginId, config) => ipcRenderer.invoke('plugins:update-config', pluginId, config),
    getDir: () => ipcRenderer.invoke('plugins:get-dir'),
    scan: (directory) => ipcRenderer.invoke('plugins:scan', directory),
    onInstalled: (callback) => {
      const subscription = (event, manifest) => callback(manifest);
      ipcRenderer.on('plugin:installed', subscription);
      return () => ipcRenderer.removeListener('plugin:installed', subscription);
    },
    onUninstalled: (callback) => {
      const subscription = (event, { pluginId }) => callback(pluginId);
      ipcRenderer.on('plugin:uninstalled', subscription);
      return () => ipcRenderer.removeListener('plugin:uninstalled', subscription);
    },
    onConfigUpdated: (callback) => {
      const subscription = (event, { pluginId, config }) => callback({ pluginId, config });
      ipcRenderer.on('plugin:config-updated', subscription);
      return () => ipcRenderer.removeListener('plugin:config-updated', subscription);
    },
  },

  pluginApi: {
    readFile: (filePath) => ipcRenderer.invoke('plugin-api:read-file', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('plugin-api:write-file', filePath, content),
    log: (message, level) => ipcRenderer.invoke('plugin-api:log', message, level),
  },

  // Siri & Shortcuts Integration
  siri: {
    executeAction: (action, params) => ipcRenderer.invoke('siri:execute-action', action, params),
    speak: (text) => ipcRenderer.invoke('siri:speak', text),
    listen: (timeout) => ipcRenderer.invoke('siri:listen', timeout),
    getVoices: () => ipcRenderer.invoke('siri:get-voices'),
    getUrlScheme: () => ipcRenderer.invoke('siri:get-url-scheme'),
    getShortcutsList: () => ipcRenderer.invoke('siri:get-shortcuts-list'),
    parseCommand: (transcript) => ipcRenderer.invoke('voice:parse-command', transcript),
    onChatInput: (callback) => {
      const subscription = (event, message) => callback(message);
      ipcRenderer.on('siri-chat-input', subscription);
      return () => ipcRenderer.removeListener('siri-chat-input', subscription);
    },
    onNavigate: (callback) => {
      const subscription = (event, url) => callback(url);
      ipcRenderer.on('siri-navigate', subscription);
      return () => ipcRenderer.removeListener('siri-navigate', subscription);
    },
    onSearch: (callback) => {
      const subscription = (event, query) => callback(query);
      ipcRenderer.on('siri-search', subscription);
      return () => ipcRenderer.removeListener('siri-search', subscription);
    },
    onCreatePDF: (callback) => {
      const subscription = (event, data) => callback(data);
      ipcRenderer.on('siri-create-pdf', subscription);
      return () => ipcRenderer.removeListener('siri-create-pdf', subscription);
    },
    onShellCommand: (callback) => {
      const subscription = (event, command) => callback(command);
      ipcRenderer.on('siri-shell-command', subscription);
      return () => ipcRenderer.removeListener('siri-shell-command', subscription);
    },
    onSchedule: (callback) => {
      const subscription = (event, data) => callback(data);
      ipcRenderer.on('siri-schedule', subscription);
      return () => ipcRenderer.removeListener('siri-schedule', subscription);
    },
    onAskAI: (callback) => {
      const subscription = (event, data) => callback(data);
      ipcRenderer.on('siri-ask-ai', subscription);
      return () => ipcRenderer.removeListener('siri-ask-ai', subscription);
    },
  },

  // AppleScript Bridge
  applescript: {
    run: (command, params) => ipcRenderer.invoke('applescript:run', command, params),
    speak: (text, rate, voice) => ipcRenderer.invoke('applescript:speak', text, rate, voice),
    listen: (timeout) => ipcRenderer.invoke('applescript:listen', timeout),
    getVoices: () => ipcRenderer.invoke('applescript:get-voices'),
    createShortcut: (name, params) => ipcRenderer.invoke('applescript:create-shortcut', name, params),
  },

  // Raycast Integration
  raycast: {
    execute: (url) => ipcRenderer.invoke('raycast:protocol', url),
    getManifest: () => ipcRenderer.invoke('raycast:get-manifest'),
  },

  // Windows Integration
  windows: {
    executeAction: (action, params) => ipcRenderer.invoke('windows:execute-action', action, params),
    openCopilot: () => ipcRenderer.invoke('windows:copilot:open'),
    voice: {
      listen: (params) => ipcRenderer.invoke('windows:voice:listen', params),
      speak: (text, params) => ipcRenderer.invoke('windows:voice:speak', text, params),
      getVoices: () => ipcRenderer.invoke('windows:voice:get-voices'),
    },
    generateUrl: (action, params) => ipcRenderer.invoke('windows:generate-url', action, params),
    createShortcut: (name, action, params) => ipcRenderer.invoke('windows:create-shortcut', name, action, params),
    getShortcutsList: () => ipcRenderer.invoke('windows:get-shortcuts-list'),
    registerProtocol: () => ipcRenderer.invoke('windows:register-protocol'),
  },

  // RAG (Retrieval Augmented Generation)
  ragIngest: (text, source) => ipcRenderer.invoke('rag-ingest', { text, source }),
  ragRetrieve: (query, k) => ipcRenderer.invoke('rag-retrieve', { query, k }),
  ragContext: (query, k) => ipcRenderer.invoke('rag-context', { query, k }),
  voiceTranscribe: (audioBase64, format) => ipcRenderer.invoke('voice-transcribe', { audioBase64, format }),
  voiceMicPermission: () => ipcRenderer.invoke('voice-mic-permission'),

  // AI User Preferences (auto-learned)
  saveUserPreference: (key, value) => ipcRenderer.invoke('user-preference:save', { key, value }),
  loadUserPreferences: () => ipcRenderer.invoke('user-preference:load-all'),
  deleteUserPreference: (key) => ipcRenderer.invoke('user-preference:delete', key),

  // Linux Integration
  linux: {
    executeAction: (action, params) => ipcRenderer.invoke('linux:execute-action', action, params),
    getDesktop: () => ipcRenderer.invoke('linux:desktop:get'),
    notify: (title, body, options) => ipcRenderer.invoke('linux:notify', title, body, options),
    voice: {
      listen: (params) => ipcRenderer.invoke('linux:voice:listen', params),
      speak: (text, params) => ipcRenderer.invoke('linux:voice:speak', text, params),
      getVoices: () => ipcRenderer.invoke('linux:voice:get-voices'),
    },
    generateUrl: (action, params) => ipcRenderer.invoke('linux:generate-url', action, params),
    createShortcut: (name, action, params) => ipcRenderer.invoke('linux:create-shortcut', name, action, params),
    installGnomeShortcut: (name, action, params) => ipcRenderer.invoke('linux:install-gnome-shortcut', name, action, params),
    createLauncher: () => ipcRenderer.invoke('linux:create-launcher'),
    registerProtocol: () => ipcRenderer.invoke('linux:register-protocol'),
  },

  // macOS Shortcuts.app CLI bridge (shortcuts list/run/view)
  shortcuts: {
    list: () => ipcRenderer.invoke('shortcuts:list'),
    run: (name, input) => ipcRenderer.invoke('shortcuts:run', name, input),
    view: (name) => ipcRenderer.invoke('shortcuts:view', name),
  },
});
