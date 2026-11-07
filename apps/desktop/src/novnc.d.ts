declare module "@novnc/novnc" {
  export default class RFB {
    constructor(
      target: HTMLElement,
      urlOrChannel: string | WebSocket,
      options?: { credentials?: { password?: string }; wsProtocols?: string[] },
    );
    scaleViewport: boolean;
    clipViewport: boolean;
    background: string;
    viewOnly: boolean;
    disconnect(): void;
    addEventListener(type: string, listener: (ev: { detail?: { clean?: boolean } }) => void): void;
  }
}
