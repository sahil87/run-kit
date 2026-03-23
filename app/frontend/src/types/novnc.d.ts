declare module "@novnc/novnc/lib/rfb" {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket, options?: {
      shared?: boolean;
      credentials?: { username?: string; password?: string; target?: string };
      repeaterID?: string;
      wsProtocols?: string[];
    });

    /** Scale the remote display to fit the container. */
    scaleViewport: boolean;
    /** Resize the remote display to match the container size. */
    resizeSession: boolean;
    /** Show a dot cursor instead of no cursor. */
    showDotCursor: boolean;
    /** The background color of the container. */
    background: string;
    /** Whether to enable qualityLevel (JPEG quality). */
    qualityLevel: number;
    /** Compression level. */
    compressionLevel: number;
    /** Whether the clipboard should be updated. */
    clipboardPasteFrom: string;
    /** Clipboard content from the remote session. */
    readonly capabilities: { power: boolean };
    /** Whether the connection is in focus. */
    readonly focusOnClick: boolean;

    /** Send clipboard text to the remote session. */
    clipboardPasteFrom: string;

    /** Disconnect from the server. */
    disconnect(): void;

    /** Send credentials (in response to a "credentialsrequired" event). */
    sendCredentials(credentials: { username?: string; password?: string; target?: string }): void;

    /** Send Ctrl+Alt+Del to the remote session. */
    sendCtrlAltDel(): void;

    /** Send a key event. */
    sendKey(keysym: number, code: string | null, down?: boolean): void;

    /** Focus the VNC canvas. */
    focus(): void;

    /** Blur the VNC canvas. */
    blur(): void;

    addEventListener(type: "connect", listener: (e: CustomEvent) => void): void;
    addEventListener(type: "disconnect", listener: (e: CustomEvent<{ clean: boolean }>) => void): void;
    addEventListener(type: "credentialsrequired", listener: (e: CustomEvent<{ types: string[] }>) => void): void;
    addEventListener(type: "clipboard", listener: (e: CustomEvent<{ text: string }>) => void): void;
    addEventListener(type: "desktopname", listener: (e: CustomEvent<{ name: string }>) => void): void;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  }
}
