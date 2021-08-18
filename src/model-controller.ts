import {ReactiveController, ReactiveControllerHost} from 'lit';

export function isRpcRequest(
  data: RpcRequest | RpcResponse
): data is RpcRequest {
  return (data as RpcRequest).method !== undefined;
}

function rpcGetData(path?: string): string {
  const rpc = {
    jsonrpc: '2.0',
    method: 'get',
    params: [path ?? '.'],
    id: path ?? '.',
  };
  return JSON.stringify(rpc);
}

function rpcSetData(data: unknown, path?: string): string {
  const rpc = {
    jsonrpc: '2.0',
    method: 'set',
    params: [data, path ?? '.'],
    id: null,
  };
  return JSON.stringify(rpc);
}

function rpcMulticast(data: unknown, path?: string): string {
  const rpc = {
    jsonrpc: '2.0',
    method: 'MULTICAST',
    params: [data, path ?? '.'],
  };
  return JSON.stringify(rpc);
}

export interface RemoteModelHost extends ReactiveControllerHost {
  onUpdate?(data: unknown, path?: string): void;
  onMulticast?(data: unknown): void;
  onStreaming?(data: Blob | ArrayBuffer): Promise<void>;
  onOpen?(ev: Event): void;
  onClose?(ev: CloseEvent): void;
  onError?(ev: Event | ErrorEvent): void;
}

export class ModelController implements ReactiveController {
  host: RemoteModelHost;
  wsUrl: string;
  private conn?: WebSocket;
  maxSize = 60000;

  constructor(host: RemoteModelHost, url: string) {
    (this.host = host).addController(this);
    this.wsUrl = url;
  }

  hostConnected() {
    this.connect();
  }

  hostDisconnected() {
    this.disconnect();
  }

  getData(path?: string) {
    if (!this.conn) throw new Error('disconnected');
    const req = rpcGetData(path);
    this.conn.send(req);
  }

  setData(value: unknown, path?: string) {
    if (!this.conn) throw new Error('disconnected');
    this.conn.send(rpcSetData(value, path));
  }

  streaming(data: ArrayBuffer) {
    if (!this.conn) throw new Error('disconnected');
    const total = data.byteLength;
    if (total < this.maxSize) return this.conn.send(data);
    let offset = 0;
    while (offset < total) {
      const length = Math.min(this.maxSize, total - offset);
      const block = new DataView(data, offset, length);
      offset += length;
      this.conn.send(block);
    }
  }

  multicast(value: unknown, path?: string) {
    if (!this.conn) throw new Error('disconnected');
    this.conn.send(rpcMulticast(value, path));
  }

  connect() {
    this.disconnect();
    this.conn = new WebSocket(this.wsUrl);
    this.conn.onmessage = (ev) => this.onMessage(ev);
    this.conn.onopen = (ev) => this.onOpen(ev);
    this.conn.onclose = (ev) => this.onClose(ev);
    this.conn.onerror = (ev) => this.onError(ev);
  }

  disconnect() {
    if (this.conn) {
      this.conn.close();
      this.conn = undefined;
    }
  }

  onMessage(ev: MessageEvent) {
    if (ev.data instanceof Blob || ev.data instanceof ArrayBuffer) {
      // const idData = await ev.data.slice(0, 4).arrayBuffer();
      // const id = new Uint32Array(idData);
      // const data = await ev.data.slice(4).arrayBuffer();
      if (this.host.onStreaming)
        this.host
          .onStreaming(ev.data)
          .then(() => {})
          .catch((err) => console.log('streaming error', err));
      return;
    }
    const data: RpcRequest | RpcResponse = JSON.parse(ev.data);
    if (isRpcRequest(data)) {
      switch (data.method) {
        case 'UPDATE': {
          if (this.host.onUpdate && Array.isArray(data.params)) {
            const value = data.params[3];
            const path = data.params[2] as string;
            this.host.onUpdate(value, path);
          }
          break;
        }
        case 'MULTICAST': {
          if (this.host.onMulticast) this.host.onMulticast(data.params);
          break;
        }
      }
    } else {
      if (this.host.onUpdate && data.id) {
        this.host.onUpdate(data.result, data.id as string);
      }
    }
  }

  onOpen(ev: Event) {
    if (this.host.onOpen) this.host.onOpen(ev);
  }
  onError(ev: Event | ErrorEvent) {
    if (this.host.onError) this.host.onError(ev);
  }

  onClose(ev: CloseEvent) {
    this.conn = undefined;
    if (this.host.onClose) this.host.onClose(ev);
  }

  get connected(): boolean {
    return !!this.conn;
  }
}

export interface RpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Array<unknown> | Record<string, unknown>;
  id?: string | number;
}

export interface RpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: ErrorData;
  id: string | number | null;
}

export interface ErrorData {
  code: number;
  message: string;
  data?: unknown;
}
