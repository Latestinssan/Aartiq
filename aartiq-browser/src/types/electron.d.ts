import { ChatMessage } from "../lib/llm/providers/base";

declare global {
    interface Window {
        pdfjsLib: any;
        electronAPI: {
            // BrowserView related APIs
            getIsOnline: () => Promise<boolean>;
            getPlatform: () => string;
            isMicrosoftStore: () => Promise<boolean>;
            getAppleIntelligenceStatus: () => Promise<{ success: boolean; available?: boolean; supportsSummaries?: boolean; supportsImageGeneration?: boolean; supportsGenmoji?: boolean; summaryAvailable?: boolean; imageAvailable?: boolean; genmojiAvailable?: boolean; summaryReason?: string; imageReason?: string; genmojiReason?: string; osVersion?: string; availableStyles?: string[]; error?: string }>;
            summarizeWithAppleIntelligence: (text: string) => Promise<{ success: boolean; available?: boolean; summaryAvailable?: boolean; summaryReason?: string; osVersion?: string; summary?: string; error?: string }>;
            generateAppleIntelligenceImage: (payload: { prompt: string; outputPath?: string; style?: string }) => Promise<{ success: boolean; available?: boolean; imageAvailable?: boolean; imageReason?: string; osVersion?: string; imagePath?: string; error?: string }>;
            generateGenmoji: (payload: { prompt: string }) => Promise<{ success: boolean; available?: boolean; genmojiAvailable?: boolean; genmojiReason?: string; osVersion?: string; genmojiPath?: string; error?: string }>;
            
            // Biometric Authentication
            checkBiometricAuth: () => Promise<{ available: boolean; type: string; platform: string; message?: string }>;
            authenticateBiometric: (reason: string) => Promise<{ success: boolean; method?: string; error?: string; message?: string }>;
            executeWithAuth: (actions: Array<{ type: string; url?: string; command?: string; ms?: number }>, reason: string) => Promise<Array<{ success: boolean; action: string; url?: string; error?: string }>>;
            
            onAiQueryDetected: (callback: (query: string) => void) => () => void;
            createView: (args: { tabId: string; url: string }) => void;
            activateView: (args: { tabId: string; bounds: { x: number; y: number; width: number; height: number } }) => void;
            destroyView: (tabId: string) => void;
            hideAllViews: () => void;
            showAllViews: () => void;
            onBrowserViewUrlChanged: (callback: (data: { tabId: string; url: string }) => void) => () => void;
            onBrowserViewTitleChanged: (callback: (data: { tabId: string; title: string }) => void) => () => void;
            navigateBrowserView: (args: { tabId: string; url: string }) => void;
            navigateTo: (url: string) => void;
            goBack: () => void;
            goForward: () => void;
            reload: () => void;
            getCurrentUrl: () => Promise<string>;
            extractPageContent: (tabId?: string) => Promise<{ content?: string; error?: string }>;
            extractSecureDOM: () => Promise<{
                content: string;
                elements: Array<{ tag: string; text: string; xpath: string; children: any[] }>;
                links: Array<{ href: string; title: string; text: string }>;
                metadata: {
                    url: string;
                    title: string;
                    timestamp: number;
                    injectionDetected: boolean;
                    filterStats: {
                        piiRemoved: number;
                        scriptsRemoved: number;
                        stylesRemoved: number;
                        navRemoved: number;
                        adsRemoved: number;
                    };
                };
                error?: string;
            }>;
            searchDOM: (query: string) => Promise<{
                results: Array<{
                    text: string;
                    context: string;
                    xpath: string;
                    score: number;
                    tag: string;
                }>;
                query: string;
                error?: string;
            }>;
            setBrowserViewBounds: (bounds: { x: number; y: number; width: number; height: number }) => void;
            capturePageHtml: () => Promise<string>;
            saveOfflinePage: (data: { url: string; title: string, html: string }) => Promise<boolean>;
            setUserAgent: (userAgent: string) => Promise<boolean>;
            setProxy: (config: any) => Promise<boolean>;
            setNativeThemeSource: (source: 'system' | 'light' | 'dark') => Promise<{ success: boolean; themeSource: 'system' | 'light' | 'dark' }>;
            getNetworkSecurityConfig: () => Promise<{ success: boolean; config: any; restartRequiredFor: string[] }>;
            updateNetworkSecurityConfig: (config: any) => Promise<{ success: boolean; config: any; restartRequiredFor: string[]; error?: string }>;
            capturePage: () => Promise<string>;
            sendInputEvent: (input: any) => Promise<void>;
            openDevTools: () => void;
            changeZoom: (deltaY: number) => void;
            onAudioStatusChanged: (callback: (isPlaying: boolean) => void) => () => void;
            onWindowFullscreenChanged: (callback: (isFullscreen: boolean) => void) => () => void;

            // Download APIs
            onDownloadStarted: (callback: (filename: string) => void) => () => void;
            onDownloadProgress: (callback: (data: { name: string, progress: number }) => void) => () => void;
            onDownloadComplete: (callback: (filename: string) => void) => () => void;
            triggerDownload: (url: string, filename: string) => Promise<boolean>;
            on: (channel: string, listener: (...args: any[]) => void) => () => void; // Generic 'on' for ipcRenderer events
            send: (channel: string, ...args: any[]) => void; // Generic 'send' for ipcRenderer events
            invoke: (channel: string, ...args: any[]) => Promise<any>; // Generic 'invoke' for ipcRenderer.invoke
            onAddNewTab: (callback: (url: string) => void) => () => void; // Specific add new tab event

            getSuggestions: (query: string) => Promise<any[]>; // New IPC handler

            // LLM & Memory APIs
            getAvailableLLMProviders: () => Promise<{ id: string; name: string }[]>;
            getProviderModels: (providerId: string, options?: { forceRefresh?: boolean }) => Promise<{
                success: boolean;
                providerId: string;
                providerName?: string;
                docsUrl?: string;
                models: Array<{
                    id: string;
                    label?: string;
                    ownedBy?: string;
                    created?: number | null;
                    contextWindow?: number | null;
                    description?: string;
                    inputTokenLimit?: number | null;
                    outputTokenLimit?: number | null;
                }>;
                recommendedModel?: string;
                fetchedAt?: number;
                requiresApiKey?: boolean;
                warning?: string;
                error?: string;
            }>;
            setActiveLLMProvider: (providerId: string) => Promise<boolean>;
            configureLLMProvider: (providerId: string, options: any) => Promise<boolean>;
            getStoredApiKeys: () => Promise<any>;
            getAISettings: (category?: string) => Promise<any>;
            updateAISettings: (category: string, updates: Record<string, any>) => Promise<{ success: boolean; applied?: Record<string, any>; category?: string; error?: string }>;
            triggerShortcut: (action: string) => Promise<any>;
            getOnboardingState: () => Promise<{
                hasSeenWelcomePage: boolean;
                hasCompletedStartupSetup: boolean;
                hasSeenNeuralSetup: boolean;
            }>;
            setOnboardingState: (partial: {
                hasSeenWelcomePage?: boolean;
                hasCompletedStartupSetup?: boolean;
                hasSeenNeuralSetup?: boolean;
            }) => Promise<boolean>;
            generateChatContent: (messages: ChatMessage[], options?: any) => Promise<{ text?: string; thought?: string; error?: string }>;
            streamChatContent: (messages: ChatMessage[], options?: any) => void;
            onChatStreamPart: (callback: (part: any) => void) => () => void;
            getAiMemory: () => Promise<any[]>;
            addAiMemory: (entry: any) => void;
            getSelectedText: () => Promise<string>; // For context menu integration
            sendToAIChatInput: (text: string) => void; // For sending selected text to AI chat
            captureBrowserViewScreenshot: () => Promise<string>; // For vision capabilities
            loadSkill: (skillId: string) => Promise<string>; // Load modular AI skills context

            // Dev-MCP & Analytics
            sendMcpCommand: (command: string, data: any) => Promise<any>;
            shareDeviceFolder: () => Promise<{ path?: string; success: boolean }>;
            setMcpServerPort: (port: number) => void; // For updating the MCP server port

            // Ollama specific APIs
            ollamaListModels: () => Promise<{ models: { name: string; modified_at: string }[]; error?: string }>;

            // Window Controls
            minimizeWindow: () => void;
            maximizeWindow: () => void;
            closeWindow: () => void;
            toggleFullscreen: () => void;
            setAsDefaultBrowser: () => Promise<boolean>;
            showWebview: () => void;
            hideWebview: () => void;
            bringWindowToTop: () => void;
            getOpenTabs: () => Promise<any[]>;

            // Auth
            openAuthWindow: (url: string) => void;
            closeAuthWindow: () => void;
            updateRaycastState: (state: { tabs?: Array<{ id: string; title: string; url: string; isActive?: boolean; isLoading?: boolean }>; history?: Array<{ url: string; title: string; timestamp: number }> }) => void;
            saveGoogleConfig: (config: { clientId?: string; clientSecret?: string; redirectUri?: string }) => void;
    getGoogleConfig: () => Promise<{ clientId: string; clientSecret: string; redirectUri: string }>;
    onAuthCallback: (callback: (event: any, url: string) => void) => () => void;
            onAuthTokenReceived: (callback: (token: string) => void) => () => void;

            // Chat & File Export
            exportChatAsTxt: (messages: ChatMessage[]) => Promise<boolean>;
            exportChatAsPdf: (messages: ChatMessage[]) => Promise<boolean>;
            generatePPTX: (payload: any) => Promise<{ success: boolean; path?: string; filePath?: string; error?: string }>;
            generateDOCX: (payload: any) => Promise<{ success: boolean; path?: string; filePath?: string; error?: string }>;
            generateXLSX: (payload: any) => Promise<{ success: boolean; path?: string; filePath?: string; error?: string }>;
            checkPythonAvailable: () => Promise<boolean>;

            // MCP Support
            mcpCommand: (command: string, data: any) => Promise<any>;
            mcpConnectServer: (config: { id: string; name: string; url?: string; type?: 'sse' | 'stdio'; command?: string; args?: string[]; env?: Record<string, string> }) => Promise<{ success: boolean; error?: string }>;
            mcpDisconnectServer: (id: string) => Promise<{ success: boolean; error?: string }>;
            mcpListServers: () => Promise<{ success: boolean; servers: any[], error?: string }>;
            mcpGetTools: (serverId: string) => Promise<{ success: boolean; tools: any[], error?: string }>;
            mcpCallTool: (serverId: string, toolName: string, args: any) => Promise<{ success: boolean, result?: any; error?: string }>;
            autoConfigureClaudeMcp: () => Promise<{ success: boolean; path?: string; error?: string }>;

            // Database & Sync
            initDatabase: (config: { host?: string; port?: number; user?: string; password?: string; database?: string }) => Promise<{ success: boolean; error?: string }>;
            syncData: (params: { userId: string; type: string; data: any[]; direction: 'push' | 'pull' }) => Promise<{ success: boolean; synced?: number }>;

            // P2P File Sync
            scanFolder: (path: string, types: string[]) => Promise<any[]>;
            readFileBuffer: (path: string) => Promise<ArrayBuffer>;

            // Phone Control
            sendPhoneCommand: (command: string, data: any) => Promise<void>;

            // Contacts
            getDeviceContacts: () => Promise<any[]>;
            syncContacts: (deviceId: string, contacts: any[]) => Promise<{ success: boolean; synced: number }>;

            // OTP
            startSMSListener: () => Promise<boolean>;
            startEmailListener: () => Promise<boolean>;
            syncOTP: (otp: any) => Promise<void>;
            requestSMSPermission: () => Promise<boolean>;
            onShortcut: (callback: (action: string) => void) => () => void;
            updateShortcuts: (shortcuts: { action: string; accelerator: string }[]) => void;

            // Tab Optimization
            suspendTab: (tabId: string) => void;
            resumeTab: (tabId: string) => void;
            getMemoryUsage: () => Promise<any>;
            // RAG Persistence & Ollama
            saveVectorStore: (data: any[]) => Promise<boolean>;
            loadVectorStore: () => Promise<any[]>;
            clearVectorStore: () => Promise<{ success: boolean }>;


            // Tab Management
            onTabLoaded: (callback: (data: { tabId: string; url: string }) => void) => () => void;
            onTabLoadingStatus: (callback: (data: { tabId: string; isLoading: boolean }) => void) => () => void;
            onTabSuspended: (callback: (tabId: string) => void) => () => void;
            onTabResumed: (callback: (tabId: string) => void) => () => void;
            onResumeTabAndActivate: (callback: (tabId: string) => void) => () => void;
            extractSearchResults: (tabId: string) => Promise<{ success: boolean; results?: any[]; error?: string }>;
            addNewTab: (url: string) => void;

            // Shell Commands
            executeShellCommand: (args: string | { rawCommand: string, preApproved?: boolean, reason?: string, riskLevel?: string }) => Promise<{ success: boolean; output?: string; error?: string }>;
            onShellPermissionRequest: (callback: (payload: { requestId: string; command: string; reason: string; riskLevel: string }) => void) => () => void;
            respondShellPermission: (requestId: string, granted: boolean, remember?: boolean) => void;
            getCliToken: () => Promise<{ success: boolean; token?: string; tokenPath?: string; error?: string }>;
            regenerateCliToken: () => Promise<{ success: boolean; token?: string; tokenPath?: string; error?: string }>;

            // Cross-App Control APIs
            captureScreenRegion: (coords: { x: number; y: number; width: number; height: number }) => Promise<{ success: boolean; image?: string; error?: string }>;
            searchApplications: (query: string) => Promise<{ success: boolean; results: any[]; error?: string }>;
            openExternalApp: (appPath: string) => Promise<{ success: boolean; error?: string }>;
            openSystemSettings: (url: string) => Promise<{ success: boolean; error?: string }>;
            performCrossAppClick: (coords: { x: number; y: number }) => Promise<{ success: boolean; error?: string }>;
            onOpenUnifiedSearch: (callback: () => void) => () => void;
            clickAppElement: (appName: string, elementText: string, reason: string) => Promise<{ success: boolean; error?: string }>;
            typeTextApp: (text: string) => Promise<{ success: boolean; error?: string }>;

            // Element Control (deprecated - use performCrossAppClick instead)
            clickElement: (selector: string) => Promise<{ success: boolean; error?: string }>;
            typeText: (selector: string, text: string) => Promise<{ success: boolean; error?: string }>;
            fillForm: (data: { selector: string; value: string; delayBetweenFields?: number; retry?: number; verify?: boolean; clearFirst?: boolean }) => Promise<{ success: boolean; error?: string }>;
            multiFillForm: (opts: { fields: Record<string, string>; delayBetweenFields?: number; retry?: number; verify?: boolean }) => Promise<{ success: boolean; results?: Array<{ selector: string; success: boolean; error?: string }>; error?: string }>;
            findAndClickText: (targetText: string) => Promise<{ success: boolean; x?: number; y?: number; error?: string; foundText?: string }>;

            // Gmail Integration
            gmailAuthorize: () => Promise<{ success: boolean; error?: string }>;
            gmailListMessages: (query: string, maxResults: number) => Promise<{ success: boolean; messages?: any[]; error?: string }>;
            gmailGetMessage: (messageId: string) => Promise<{ success: boolean; message?: any; error?: string }>;
            gmailSendMessage: (to: string, subject: string, body: string, threadId?: string | null) => Promise<{ success: boolean; result?: any; error?: string }>;
            gmailAddLabelToMessage: (messageId: string, labelName: string) => Promise<{ success: boolean; result?: any; error?: string }>;
            onGmailOAuthCode: (callback: (code: string) => void) => () => void;

            // AI Response
            saveAiResponse: (content: string) => void;

            // LLM Provider Testing
            testGeminiApi: (apiKey: string) => Promise<{ success: boolean; error?: string }>;

            // Alarm & Applications
            setAlarm: (alarmTime: string, message: string) => Promise<{ success: boolean; error?: string }>;
            setUserId: (userId: string | null) => void;
            getExtensions: () => Promise<any[]>;
            getExtensionActions: () => Promise<any[]>;
            onExtensionActionUpdated: (callback: (data: any) => void) => () => void;
            onExtensionInstalled: (callback: (data: any) => void) => () => void;
            onExtensionRemoved: (callback: (data: any) => void) => () => void;
            onExtensionUpdated: (callback: (data: any) => void) => () => void;
            openExtensionPopup: (extensionId: string) => Promise<void>;
            selectAndInstallExtension: () => Promise<{ success: boolean; extension?: { name: string; id?: string }; error?: string }>;
            toggleExtension: (id: string) => Promise<{ success: boolean; enabled?: boolean; error?: string }>;
            uninstallExtension: (id: string) => Promise<boolean>;
            openExtensionDir: () => void;
            getExtensionPath: () => Promise<string>;
            getIconPath: () => Promise<string>;
            connectToRemoteDevice: (remoteDeviceId: string) => Promise<boolean>;
            sendP2PSignal: (signal: any, remoteDeviceId: string) => void;
            onP2PConnected: (callback: () => void) => () => void;
            onP2PDisconnected: (callback: () => void) => () => void;
            onP2PFirebaseReady: (callback: (userId: string) => void) => () => void;
            onP2POfferCreated: (callback: (data: { offer: any; remoteDeviceId: string }) => void) => () => void;
            onP2PAnswerCreated: (callback: (data: { answer: any; remoteDeviceId: string }) => void) => () => void;
            onP2PIceCandidate: (callback: (data: { candidate: any; remoteDeviceId: string }) => void) => () => void;
            onP2PLocalDeviceId: (callback: (deviceId: string) => void) => () => void;
            getP2PLocalDeviceId: () => Promise<string>;
            onP2PMessage: (callback: (message: any) => void) => () => void;
            encryptData: (data: ArrayBuffer, key: string) => Promise<{ encryptedData: ArrayBuffer; iv: ArrayBuffer; authTag: ArrayBuffer; salt: ArrayBuffer; } | { error: string }>;
            decryptData: (encryptedData: ArrayBuffer, key: string, iv: ArrayBuffer, authTag: ArrayBuffer, salt: ArrayBuffer) => Promise<{ decryptedData: ArrayBuffer; } | { error: string }>;
            // scanFolder and readFileBuffer are already defined above (lines 88-89)

            // Persistent Storage
            savePersistentData: (key: string, data: any) => Promise<{ success: boolean; error?: string }>;
            loadPersistentData: (key: string) => Promise<{ success: boolean; data?: any; error?: string }>;
            deletePersistentData: (key: string) => Promise<{ success: boolean; error?: string }>;
            getMacNativeUIPreferences: () => Promise<{ success: boolean; preferences?: { sidebarMode: 'electron' | 'swiftui'; actionChainMode: 'electron' | 'swiftui'; utilityMode: 'electron' | 'swiftui'; permissionMode: 'electron' | 'swiftui'; sidebarAutoMinimize?: boolean; sidebarGradientPreset?: 'graphite' | 'ocean' | 'aurora'; sidebarShowQuickActions?: boolean; sidebarShowSessions?: boolean; sidebarShowSearchTags?: boolean; sidebarShowCommandCenterButton?: boolean; sidebarShowActionChainButton?: boolean }; available?: boolean; error?: string }>;
            setMacNativeUIPreferences: (preferences: Partial<{ sidebarMode: 'electron' | 'swiftui'; actionChainMode: 'electron' | 'swiftui'; utilityMode: 'electron' | 'swiftui'; permissionMode: 'electron' | 'swiftui'; sidebarAutoMinimize: boolean; sidebarGradientPreset: 'graphite' | 'ocean' | 'aurora'; sidebarShowQuickActions: boolean; sidebarShowSessions: boolean; sidebarShowSearchTags: boolean; sidebarShowCommandCenterButton: boolean; sidebarShowActionChainButton: boolean }>) => Promise<{ success: boolean; preferences?: { sidebarMode: 'electron' | 'swiftui'; actionChainMode: 'electron' | 'swiftui'; utilityMode: 'electron' | 'swiftui'; permissionMode: 'electron' | 'swiftui'; sidebarAutoMinimize?: boolean; sidebarGradientPreset?: 'graphite' | 'ocean' | 'aurora'; sidebarShowQuickActions?: boolean; sidebarShowSessions?: boolean; sidebarShowSearchTags?: boolean; sidebarShowCommandCenterButton?: boolean; sidebarShowActionChainButton?: boolean }; available?: boolean; error?: string }>;
            showMacNativePanel: (mode: 'sidebar' | 'action-chain' | 'menu' | 'settings' | 'downloads' | 'clipboard' | 'permissions') => Promise<{ success: boolean; reused?: boolean; error?: string }>;
            toggleMacNativePanel: (mode: 'sidebar' | 'action-chain' | 'menu' | 'settings' | 'downloads' | 'clipboard' | 'permissions') => Promise<{ success: boolean; closed?: boolean; reused?: boolean; error?: string }>;
            updateNativeMacUIState: (state: {
                inputDraft?: string;
                isLoading?: boolean;
                error?: string | null;
                themeAppearance?: 'dark' | 'light';
                currentCommandIndex?: number;
                messages?: Array<{ id?: string; role: string; content: string; timestamp?: number }>;
                actionChain?: Array<{ id?: string; type: string; value: string; status: string; category?: string; riskLevel?: string }>;
                activityTags?: string[];
                conversations?: Array<{ id: string; title: string; updatedAt: number }>;
                activeConversationId?: string | null;
                downloads?: Array<{ name: string; status: string; progress?: number; path?: string }>;
                clipboardItems?: string[];
                thinkingSteps?: Array<{ id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string; timestamp: number }>;
            }) => void;
            onMacNativeUIPreferencesChanged: (callback: (preferences: { sidebarMode: 'electron' | 'swiftui'; actionChainMode: 'electron' | 'swiftui'; utilityMode: 'electron' | 'swiftui'; permissionMode: 'electron' | 'swiftui'; sidebarAutoMinimize?: boolean; sidebarGradientPreset?: 'graphite' | 'ocean' | 'aurora'; sidebarShowQuickActions?: boolean; sidebarShowSessions?: boolean; sidebarShowSearchTags?: boolean; sidebarShowCommandCenterButton?: boolean; sidebarShowActionChainButton?: boolean }) => void) => () => void;
            onNativeMacPrompt: (callback: (payload: { prompt: string; source?: string }) => void) => () => void;
            notifyAiSidebarOpen: () => void;
            notifyAiSidebarClosed: () => void;
            notifyApprovalPending: (details: { requestId?: string; command: string; reason?: string; risk?: string; highRiskQr?: string | null; expectedPin?: string | null; actionType?: string; action?: string; requiresDeviceUnlock?: boolean }) => void;
            notifyApprovalCleared: () => void;
            onApprovalActionResolved: (callback: (data: { requestId: string; allowed: boolean; deviceUnlockValidated?: boolean }) => void) => () => void;

            // Ticket-based approval (CapabilityController)
            approveTicket: (ticketId: string) => Promise<boolean>;
            denyTicket: (ticketId: string, reason?: string) => Promise<boolean>;
            onApprovalRequired: (callback: (ticket: { ticketId: string; action: string; params: Record<string, any>; metadata?: { riskLevel?: string; description?: string; approvalReason?: string }; expiresAt: number }) => void) => () => void;

            // Event Listeners for UI updates
            onNetworkStatusChanged: (callback: (isOnline: boolean) => void) => () => void;
            onClipboardChanged: (callback: (text: string) => void) => () => void;
            onAIChatInputText: (callback: (text: string) => void) => () => void;
            onAiChatInputText: (callback: (text: string) => void) => () => void;
            translateWebsite: (args: { targetLanguage: string; method?: 'google' | 'chrome-ai' }) => Promise<{ success?: boolean; error?: string }>;
            onTriggerTranslationDialog: (callback: () => void) => () => void;
            onAutomationShellApproval: (callback: (payload: { requestId: string; command: string; risk: string; reason?: string; highRiskQr?: string; requiresDeviceUnlock?: boolean; actionType?: string; action?: string }) => void) => () => void;
            respondAutomationShellApproval: (response: { requestId: string; allowed: boolean; deviceUnlockValidated?: boolean }) => void;
            // Directory permission panel — shown when LLM command accesses a blocked path
            onDirectoryPermissionRequest: (callback: (payload: { requestId: string; blockedPath: string; command: string }) => void) => () => void;
            respondDirectoryPermission: (requestId: string, granted: boolean) => void;
            getDirectoryAllowlist: () => Promise<Array<{ path: string; access: string; recursive: boolean }>>;
            addDirectoryToAllowlist: (dirPath: string, options?: { access?: string; recursive?: boolean }) => Promise<{ success: boolean; error?: string }>;
            removeDirectoryFromAllowlist: (dirPath: string) => Promise<{ success: boolean; error?: string }>;
            toggleAdblocker: (enable: boolean) => void;
            translateText: (args: { text: string; to: string; from?: string }) => Promise<{ success: boolean; translated?: string; error?: string }>;
            openSettingsPopup: (section?: string) => void;
            openProfilePopup: () => void;
            openPluginsPopup: () => void;
            openDownloadsPopup: () => void;
            openClipboardPopup: () => void;
            openCartPopup: () => void;
            openSearchPopup: (options?: any) => void;
            popSearchShow: (text: string, x: number, y: number) => Promise<{ success: boolean; error?: string }>;
            popSearchShowAtCursor: (text: string) => Promise<{ success: boolean; error?: string }>;
            popSearchGetConfig: () => Promise<{ success: boolean; config?: any; error?: string }>;
            popSearchUpdateConfig: (config: any) => Promise<{ success: boolean; error?: string }>;
            popSearchSaveConfig: (data: any) => Promise<{ success: boolean; canceled?: boolean; error?: string }>;
            popSearchLoadConfig: () => Promise<string | null>;
            openTranslatePopup: (options?: any) => void;
            openContextMenuPopup: (options?: any) => void;
            openPopupWindow: (type: string, options?: any) => void;
            closePopupWindow: (type: string) => void;
            closeAllPopups: () => void;
            onLoadAuthToken: (callback: (token: string) => void) => () => void;
            onLoadAuthSession: (callback: (session: any) => void) => () => void;
            saveAuthToken: (args: { token: string }) => void;
            saveAuthSession: (session: any) => void;
            getAuthToken: () => Promise<string | null>;
            getAuthSession: () => Promise<any>;
            getUserInfo: () => Promise<any>;
            clearAuth: () => void;
            googleOAuthLogin: () => void;
            onGoogleOAuthCode: (callback: (code: string) => void) => () => void;
            onSetSettingsSection: (callback: (section: string) => void) => () => void;

            getWifiSyncUri: () => Promise<string | null>;
            getWifiSyncQr: (cloudMode?: boolean) => Promise<string | null>;
            getWifiSyncInfo: () => Promise<{ deviceName: string, pairingCode: string, ip: string, port: number }>;
            getWifiSyncDevices: () => Promise<Array<{ deviceId: string; deviceName: string; deviceType: 'mobile' | 'desktop'; ip: string; port: number; platform?: string; trustLevel: 'trusted' | 'ask_once' | 'blocked'; autoConnect: boolean; online: boolean; lastConnected?: number; lastSeen?: number }>>;
            setWifiSyncDeviceTrust: (payload: { deviceId: string; trustLevel: 'trusted' | 'ask_once' | 'blocked'; autoConnect?: boolean }) => Promise<{ success: boolean; device?: any; error?: string }>;
            removeWifiSyncDevice: (deviceId: string) => Promise<{ success: boolean; error?: string }>;
            onWifiSyncStatus: (callback: (data: { connected: boolean }) => void) => () => void;
            onWifiSyncDevicesUpdated: (callback: (devices: Array<{ deviceId: string; deviceName: string; deviceType: 'mobile' | 'desktop'; ip: string; port: number; platform?: string; trustLevel: 'trusted' | 'ask_once' | 'blocked'; autoConnect: boolean; online: boolean; lastConnected?: number; lastSeen?: number }>) => void) => () => void;
            onRemoteAiPrompt: (callback: (data: { prompt: string; commandId: string }) => void) => () => void;
            wifiSyncBroadcast: (data: any) => void;

            // Cloud Sync
            loginToCloud: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
            logoutFromCloud: () => Promise<void>;
            saveCloudConfig: (provider: string, config: any) => Promise<{ success: boolean; error?: string }>;
            getCloudDevices: () => Promise<Array<{ deviceId: string; deviceName: string; deviceType: string; isOnline: boolean }>>;
            connectToCloudDevice: (deviceId: string) => Promise<{ success: boolean; error?: string }>;
            disconnectFromCloudDevice: (deviceId: string) => Promise<void>;
            syncClipboard: (text: string) => Promise<void>;
            syncHistory: (history: string[]) => Promise<void>;
            sendDesktopControl: (targetDeviceId: string, action: string, args?: any) => Promise<any>;
            onCloudSyncStatus: (callback: (data: { connected: boolean; userId?: string }) => void) => () => void;
            onCloudDeviceConnected: (callback: (data: { deviceId: string }) => void) => () => void;
            onCloudDeviceDisconnected: (callback: (data: { deviceId: string }) => void) => () => void;

            // Missing APIs
            generatePDF: (title: string, content: string) => Promise<{ success: boolean; fileName?: string; filePath?: string; log?: string; error?: string }>;
            generatePDFWithMethod: (method: string, options: { title: string; content: string; subtitle?: string; author?: string; template?: string; watermark?: string; bgColor?: string; priority?: string }) => Promise<{ success: boolean; fileName?: string; filePath?: string; error?: string }>;
            openPDF: (filePath: string) => Promise<{ success: boolean; error?: string }>;
            openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
            showItemInFolder: (filePath: string) => Promise<{ success: boolean }>;
            getClipboardText: () => Promise<string>;
            setClipboardText: (text: string) => void;
            setVolume: (level: number) => Promise<{ success: boolean; error?: string }>;
            setBrightness: (level: number) => Promise<{ success: boolean; error?: string }>;
            setBrowserFont: (fontFamily: string, fontSize?: number) => Promise<{ success: boolean; error?: string }>;
            performClick: (options: any) => Promise<{ success: boolean; error?: string }>;
            clickAt: (x: number, y: number) => Promise<{ success: boolean; error?: string }>;
            clickAppElement: (appName: string, elementText: string, reason: string) => Promise<{ success: boolean; error?: string }>;
            typeTextApp: (text: string) => Promise<{ success: boolean; error?: string }>;
            performOCR: (options: any) => Promise<{ success: boolean; results: any[]; error?: string }>;
            getWindowInfo: () => Promise<any>;

            // Desktop Automation v2 — Permission Store
            permGrant: (key: string, level: string, description: string, sessionOnly?: boolean) => Promise<{ success: boolean; error?: string }>;
            permRevoke: (key: string) => Promise<{ success: boolean }>;
            permRevokeAll: () => Promise<{ success: boolean }>;
            permCheck: (key: string) => Promise<{ granted: boolean }>;
            permList: () => Promise<Array<{ key: string; level: string; granted_at: number; expires_at: number | null; description: string }>>;
            permAuditLog: (limit?: number) => Promise<Array<{ entry: string; timestamp: number }>>;
            getSecuritySettings: () => Promise<{ autoApproveLowRisk: boolean; autoApproveMidRisk: boolean; requireDeviceUnlockForManualApproval: boolean; requireDeviceUnlockForVaultAccess: boolean; requireBiometricPerSession: boolean; requireBiometricEveryTime: boolean; autoApprovedCommands: string[]; autoApprovedActions: string[] }>;
            updateSecuritySettings: (settings: { autoApproveLowRisk?: boolean; autoApproveMidRisk?: boolean; requireDeviceUnlockForManualApproval?: boolean; requireDeviceUnlockForVaultAccess?: boolean; requireBiometricPerSession?: boolean; requireBiometricEveryTime?: boolean; autoApprovedActions?: string[]; autoApprovedCommands?: string[] }) => Promise<{ success: boolean; settings: { autoApproveLowRisk: boolean; autoApproveMidRisk: boolean; requireDeviceUnlockForManualApproval: boolean; requireDeviceUnlockForVaultAccess: boolean; requireBiometricPerSession: boolean; requireBiometricEveryTime: boolean; autoApprovedCommands: string[]; autoApprovedActions: string[] } }>;
            setAutoApprovalCommand: (payload: { command: string; enabled: boolean }) => Promise<{ success: boolean; commands: string[] }>;
            getAutoApprovedCommands: () => Promise<{ commands: string[] }>;
            setAutoApprovalAction: (payload: { actionType: string; enabled: boolean }) => Promise<{ success: boolean; actions: string[] }>;
            getAutoApprovedActions: () => Promise<{ actions: string[] }>;

            // Desktop Automation v2 — Robot Service
            robotExecute: (action: {
                type: 'click' | 'type' | 'key' | 'scroll';
                x?: number; y?: number;
                button?: 'left' | 'right' | 'middle';
                double?: boolean;
                text?: string;
                key?: string;
                modifiers?: ('command' | 'control' | 'alt' | 'shift')[];
                direction?: 'up' | 'down' | 'left' | 'right';
                amount?: number;
                reason: string;
            }) => Promise<{ success: boolean; error?: string }>;
            robotExecuteSequence: (actions: any[], options?: { stopOnError?: boolean; skipConfirm?: boolean }) => Promise<any[]>;
            robotKill: () => Promise<{ success: boolean }>;
            robotResetKill: () => Promise<{ success: boolean }>;
            robotStatus: () => Promise<{ available: boolean; permitted: boolean; killActive: boolean }>;
            onRobotKilled: (callback: () => void) => () => void;

            // Desktop Automation v2 — Tesseract OCR
            ocrCaptureWords: (displayId?: string) => Promise<{
                success: boolean;
                provider?: string;
                strategy?: string;
                words?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number }; centerX: number; centerY: number }>;
                lines?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number }; centerX: number; centerY: number }>;
                error?: string;
            }>;
            ocrClick: (target: string, useAi?: boolean) => Promise<{ success: boolean; clickedText?: string; method?: string; provider?: string; x?: number; y?: number; score?: number; error?: string }>;
            ocrScreenText: (displayId?: string) => Promise<{ success: boolean; text?: string; error?: string }>;

            // Desktop Automation v2 — Screen Vision AI
            visionDescribe: (question?: string) => Promise<{ success: boolean; description?: string; error?: string }>;
            visionAnalyze: (question: string) => Promise<{ success: boolean; description?: string; analysis?: string; ocrWordCount?: number; error?: string }>;
            visionCaptureBase64: () => Promise<{ success: boolean; image?: string; error?: string }>;

            // Desktop Automation v2 — AI Engine
            aiEngineChat: (opts: { message: string; model?: string; provider?: string; systemPrompt?: string; history?: Array<{ role: string; content: string }> }) => Promise<{ success: boolean; response?: string; error?: string }>;
            aiEngineConfigure: (keys: Record<string, string>) => Promise<{ success: boolean }>;

            // Flutter Bridge
            bridgeGetPairingCode: () => Promise<{ success: boolean; code?: string; error?: string }>;
            bridgeGetStatus: () => Promise<{ running: boolean; connectedDevices: number }>;
            bridgeRotateSecret: () => Promise<{ success: boolean; code?: string }>;
            bridgeBroadcast: (message: any) => Promise<{ success: boolean }>;

            // MCP Desktop — FileSystem (sandboxed)
            mcpFsRead: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
            mcpFsWrite: (filePath: string, content: string) => Promise<{ success: boolean; result?: string; error?: string }>;
            mcpFsList: (dirPath: string) => Promise<{ success: boolean; entries?: Array<{ name: string; isDirectory: boolean; path: string }>; error?: string }>;
            mcpFsApprovedDirs: () => Promise<{ success: boolean; dirs?: string[] }>;

            // MCP Desktop — NativeApp (AppleScript/PowerShell)
            mcpNativeApplescript: (script: string) => Promise<{ success: boolean; result?: string; error?: string }>;
            mcpNativePowershell: (script: string) => Promise<{ success: boolean; result?: string; error?: string }>;
            mcpNativeActiveWindow: () => Promise<{ success: boolean; app?: string; window?: string; error?: string }>;

            // Web Search v2 (Brave / Tavily / SerpAPI)
            webSearch: (query: string, provider?: 'brave' | 'tavily' | 'serp', count?: number) => Promise<{ success: boolean; results?: Array<{ title: string; url: string; snippet: string }>; error?: string }>;
            webSearchContext: (query: string, provider?: string) => Promise<{ success: boolean; context?: string; error?: string }>;
            webSearchProviders: () => Promise<{ success: boolean; providers?: string[] }>;
            webSearchConfigure: (keys: Record<string, string>) => Promise<{ success: boolean }>;
            webSearchRag: (query: string) => Promise<Array<{ title: string; url: string; snippet: string; pageContent?: string }>>;
            aiWebSearch: (query: string, engine?: string, count?: number, readCount?: number) => Promise<{ results: Array<{ title: string; url: string; snippet: string; content: string }>; engine?: string; error?: string }>;
            webSearchYoutube: (query: string, count?: number) => Promise<{ success: boolean; results?: Array<{ title: string; url: string; snippet: string; videoId: string; channel: string; length: string; thumbnail: string }>; error?: string }>;
            fetchPageContent: (url: string, maxChars?: number) => Promise<{ success: boolean; content?: string; error?: string }>;
            runResearch: (payload: { query: string; researchId?: string; queries?: string[]; budget?: Partial<{ maxQueries: number; resultsPerQuery: number; pagesToFetch: number; maxFollowUpRounds: number; days: number }> }) => Promise<{ success: boolean; error?: string; outcome?: any }>;
            onResearchProgress: (callback: (event: any) => void) => () => void;
            domClickElement: (opts: { tabId?: string; selector?: string; text?: string; 'aria-label'?: string; retry?: number; verify?: boolean }) => Promise<{ success: boolean; error?: string; method?: string; tag?: string; text?: string; rect?: { x: number; y: number; w: number; h: number } }>;
            domFillForm: (opts: { tabId?: string; selector?: string; value: string; retry?: number; verify?: boolean; clearFirst?: boolean }) => Promise<{ success: boolean; error?: string; value?: string; verified?: boolean }>;

            // RAG — Local Vector Store
            ragIngest: (text: string, source: string) => Promise<{ success: boolean; chunksAdded?: number; error?: string }>;
            ragRetrieve: (query: string, k?: number) => Promise<{ success: boolean; results?: Array<{ text: string; source: string; score: number }>; error?: string }>;
            ragContext: (query: string, k?: number) => Promise<{ success: boolean; context?: string; error?: string }>;
            ragStats: () => Promise<{ success: boolean; totalChunks?: number; sources?: string[]; error?: string }>;
            ragDeleteSource: (source: string) => Promise<{ success: boolean; deleted?: number; error?: string }>;
            ragClear: () => Promise<{ success: boolean }>;

            // Voice Control (Whisper)
            voiceTranscribe: (audioBase64: string, format?: string) => Promise<{ success: boolean; text?: string; error?: string }>;
            voiceMicPermission: () => Promise<{ success: boolean; granted?: boolean; error?: string }>;

            // Workflow Recorder
            workflowStart: () => Promise<{ success: boolean; recording?: boolean }>;
            workflowRecord: (type: string, action: any) => Promise<{ success: boolean }>;
            workflowStop: () => Promise<{ success: boolean; steps?: number }>;
            workflowSave: (name: string, description?: string) => Promise<{ success: boolean; filePath?: string; steps?: number; error?: string }>;
            workflowList: () => Promise<{ success: boolean; workflows?: Array<{ name: string; description: string; steps: number; created: number; file: string }>; error?: string }>;
            workflowReplay: (name: string) => Promise<{ success: boolean; results?: any[]; error?: string }>;
            workflowDelete: (name: string) => Promise<{ success: boolean; deleted?: boolean; error?: string }>;
            workflowStatus: () => Promise<{ success: boolean; isRecording?: boolean; stepCount?: number }>;
            generateHighRiskQr: (actionId: string) => Promise<string | null>;
            onMobileApproveHighRisk: (callback: (data: { pin: string; id: string }) => void) => () => void;
            forwardAiStream: (opts: { promptId: string; response: string; isStreaming: boolean; fromDeviceId?: string; mode?: string }) => Promise<{ success: boolean }>;
            logError: (message: string) => void;
            getAppIcon: (path?: string) => Promise<string | null>;
            getAartiqIcon: () => Promise<string | null>;
            classifyTabsAi: (args: { tabs: Array<{ id: string; title: string; url: string }> }) => Promise<{ success: boolean; classifications?: Record<string, string>; error?: string }>;
            organizeFolder: (path: string) => Promise<{ success: boolean; count?: number; summary?: string; path?: string; error?: string }>;

            // Automation & Scheduling
            scheduleTask: (taskData: {
                name: string;
                description?: string;
                type: 'ai-prompt' | 'web-scrape' | 'pdf-generate' | 'workflow' | 'daily-brief' | 'shell' | 'open-url' | string;
                cronExpression?: string;
                schedule?: string;
                prompt?: string;
                url?: string;
                action?: string;
                outputPath?: string;
                model?: string;
                provider?: string;
                notification?: any;
                enabled?: boolean;
            }) => Promise<{ success: boolean; taskId?: string; error?: string }>;
            updateScheduledTask: (taskId: string, updates: any) => Promise<{ success: boolean; error?: string }>;
            getScheduledTasks: () => Promise<any[]>;
            toggleScheduledTask: (taskId: string) => Promise<{ success: boolean; error?: string }>;
            runScheduledTask: (taskId: string) => Promise<{ success: boolean; error?: string }>;
            deleteScheduledTask: (taskId: string) => Promise<{ success: boolean; error?: string }>;
            getTaskLogs: (date?: string) => Promise<any[]>;
            enableCLI: () => Promise<{ success: boolean; message?: string; error?: string }>;
            checkCLIStatus: () => Promise<{ enabled: boolean; path: string; platform: string }>;
            disableCLI: () => Promise<{ success: boolean; message?: string; error?: string }>;
            getServiceStatus: () => Promise<{ running: boolean; health?: any; platform: string; error?: string }>;
            installService: (options: { userMode?: boolean }) => Promise<{ success: boolean; message?: string; error?: string }>;
            uninstallService: (options: { userMode?: boolean }) => Promise<{ success: boolean; message?: string; error?: string }>;
            onAutomationShellApproval: (callback: (payload: { requestId: string, command: string, risk: string, reason: string, highRiskQr?: string, requiresDeviceUnlock?: boolean, actionType?: string, action?: string }) => void) => () => void;
            submitShellApprovalResponse: (requestId: string, allowed: boolean, deviceUnlockValidated?: boolean) => void;
            // Directory permission panel
            onDirectoryPermissionRequest: (callback: (payload: { requestId: string; blockedPath: string; command: string }) => void) => () => void;
            respondDirectoryPermission: (requestId: string, granted: boolean) => void;
            getDirectoryAllowlist: () => Promise<Array<{ path: string; access: string; recursive: boolean }>>;
            addDirectoryToAllowlist: (dirPath: string, options?: { access?: string; recursive?: boolean }) => Promise<{ success: boolean; error?: string }>;
            removeDirectoryFromAllowlist: (dirPath: string) => Promise<{ success: boolean; error?: string }>;

            // Auto-update APIs
            checkForUpdates: () => Promise<{ updateAvailable?: boolean; updateInfo?: any }>;
            quitAndInstall: () => void;
            clearAuthData: () => void;
            openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
            getVersion: () => Promise<string>;
            getPlatform: () => string;
            isMicrosoftStore: () => Promise<boolean>;

            // Plugin System APIs
            plugins: {
                list: () => Promise<Array<{ id: string; name: string; version: string; description?: string; enabled: boolean; author?: string }>>;
                get: (pluginId: string) => Promise<{ id: string; name: string; version: string; description?: string; enabled: boolean; author?: string } | null>;
                install: (source: string, options?: { force?: boolean }) => Promise<{ success: boolean; pluginId?: string; error?: string }>;
                uninstall: (pluginId: string) => Promise<{ success: boolean; error?: string }>;
                update: (pluginId: string) => Promise<{ success: boolean; error?: string }>;
                enable: (pluginId: string) => Promise<{ success: boolean; error?: string }>;
                disable: (pluginId: string) => Promise<{ success: boolean; error?: string }>;
                getCommands: () => Promise<Array<{ id: string; name: string; description?: string; pluginId: string }>>;
                executeCommand: (commandId: string, params?: any) => Promise<{ success: boolean; result?: any; error?: string }>;
                updateConfig: (pluginId: string, config: any) => Promise<{ success: boolean; error?: string }>;
                getDir: () => Promise<string>;
                scan: (directory: string) => Promise<{ success: boolean; plugins?: string[]; error?: string }>;
                onInstalled: (callback: (manifest: { id: string; name: string; version: string }) => void) => () => void;
                onUninstalled: (callback: (pluginId: string) => void) => () => void;
                onConfigUpdated: (callback: (data: { pluginId: string; config: any }) => void) => () => void;
            };

            // User Preferences (AI auto-learned)
            saveUserPreference: (key: string, value: any) => Promise<{ success: boolean }>;
            loadUserPreferences: () => Promise<Record<string, { value: any; updatedAt: number }>>;
            deleteUserPreference: (key: string) => Promise<{ success: boolean }>;

            // MCP Approval Popup
            onMcpApprovalPending: (callback: (details: { requestId: string; tool: string; risk: string; args: any; url?: string }) => void) => () => void;
            mcpApprovalRespond: (requestId: string, allowed: boolean) => Promise<{ success: boolean; error?: string }>;
            mcpApprovalStatus: () => Promise<{ pending: Array<{ requestId: string }> }>;

            // File Selection
            selectLocalFile: (options?: { filters?: Array<{ name: string; extensions: string[] }>; properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles' | 'createDirectory' | 'promptToCreate' | 'noResolveAliases' | 'treatPackageAsDirectory' | 'dontAddToRecent'> }) => Promise<string | null>;

            // Password Vault
            vaultListEntries: () => Promise<{ success: boolean; entries?: Array<{ id: string; site: string; url?: string; username: string; hasPassword: boolean; passwordMasked: string; type?: 'login' | 'form' | 'note'; title?: string; created?: string | null; formData?: Array<{ label: string; value: string; name: string }> }>; error?: string }>;
            vaultSaveEntry: (entry: { id?: string; url?: string; site?: string; username?: string; password: string; name?: string; type?: string; title?: string; formData?: Array<{ label: string; value: string; name: string }> }) => Promise<{ success: boolean; entries?: Array<{ id: string; site: string; url?: string; username: string; hasPassword: boolean; passwordMasked: string; type?: 'login' | 'form' | 'note'; title?: string; created?: string | null; formData?: Array<{ label: string; value: string; name: string }> }>; error?: string }>;
            vaultDeleteEntry: (entryId: string) => Promise<{ success: boolean; entries?: Array<{ id: string; site: string; url?: string; username: string; hasPassword: boolean; passwordMasked: string; type?: 'login' | 'form' | 'note'; title?: string; created?: string | null; formData?: Array<{ label: string; value: string; name: string }> }>; error?: string }>;
            vaultReadSecret: (entryId: string) => Promise<{ success: boolean; password?: string; entry?: { id: string; url: string; username: string; password: string }; error?: string }>;
            vaultCopySecret: (entryId: string) => Promise<{ success: boolean; error?: string }>;
            vaultGenerateTotp: (entryId: string) => Promise<{ success: boolean; code?: string; remaining?: number; entryId?: string; error?: string }>;
            vaultSaveTotpSecret: (entryId: string, totpSecret: string) => Promise<{ success: boolean; error?: string }>;
            vaultRemoveTotpSecret: (entryId: string) => Promise<{ success: boolean; error?: string }>;
            vaultReadAuditLog: (limit?: number) => Promise<{ success: boolean; entries?: Array<{ action: string; entryId: string; site?: string; type?: string; timestamp: string }>; error?: string }>;
            proposePasswordSave: (data: any) => void;
            onShowPasswordSaveDialog: (callback: (data: any) => void) => () => void;

            // JavaScript Execution
            executeJavaScript: (code: string) => Promise<any>;

            // Ollama Model Management
            pullOllamaModel: (model: string, callback: (data: { model: string; output: string; done: boolean; success?: boolean }) => void) => () => void;
            importOllamaModel: (data: any) => Promise<{ success: boolean; error?: string }>;
            ollamaListModels: () => Promise<{ models: { name: string; modified_at: string }[]; error?: string }>;

        };
    }
}

export { };
