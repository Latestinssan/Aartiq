declare module 'ws' {
    class WebSocket {
        constructor(address: string, protocols?: string | string[]);
        on(event: string, callback: (...args: any[]) => void): void;
        send(data: string): void;
        close(code?: number, data?: string | Buffer): void;
        readyState: number;
        static OPEN: number;
    }
    class WebSocketServer {
        constructor(options: any);
        on(event: string, callback: (...args: any[]) => void): void;
        close(): void;
    }
    export { WebSocket, WebSocketServer };
}
