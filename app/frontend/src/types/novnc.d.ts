// noVNC 1.7.0 ships no .d.ts; this declares only the RFB surface the gui tile
// consumes. Geometry comes from the gui state payload, never from noVNC internals.
// The package's `exports` field is the string form ("./core/rfb.js" as the
// package ROOT), so the only resolvable specifier is the bare module name.
declare module "@novnc/novnc" {
  export interface RfbCredentials {
    password?: string;
  }

  export interface RfbOptions {
    shared?: boolean;
    credentials?: RfbCredentials;
    wsProtocols?: string[];
  }

  export interface RfbClipboardEventDetail {
    text: string;
  }

  export interface RfbEventMap {
    connect: CustomEvent<void>;
    disconnect: CustomEvent<{ clean: boolean }>;
    credentialsrequired: CustomEvent<void>;
    securityfailure: CustomEvent<{ status: number; reason: string }>;
    clipboard: CustomEvent<RfbClipboardEventDetail>;
    desktopname: CustomEvent<{ name: string }>;
  }

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: RfbOptions);

    scaleViewport: boolean;
    clipViewport: boolean;
    dragViewport: boolean;
    resizeSession: boolean;
    qualityLevel: number;
    compressionLevel: number;
    showDotCursor: boolean;
    viewOnly: boolean;
    focusOnClick: boolean;
    background: string;

    disconnect(): void;
    sendCredentials(credentials: RfbCredentials): void;
    clipboardPasteFrom(text: string): void;
    focus(): void;

    addEventListener<K extends keyof RfbEventMap>(
      type: K,
      listener: (event: RfbEventMap[K]) => void,
      options?: boolean | AddEventListenerOptions,
    ): void;
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener<K extends keyof RfbEventMap>(
      type: K,
      listener: (event: RfbEventMap[K]) => void,
      options?: boolean | EventListenerOptions,
    ): void;
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ): void;
  }
}
