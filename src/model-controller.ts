import {ReactiveController, ReactiveControllerHost} from "lit";

export function isRpcRequest(
  data: RpcRequest | RpcResponse
): data is RpcRequest {
  return (data as RpcRequest).method !== undefined;
}

export interface RemoteModelHost extends ReactiveControllerHost {
  onUpdate?(data: unknown, path?: string): void;
  onMulticast?(data: unknown): void;
  onStreaming?(data: Blob | ArrayBuffer): void;
  onOpen?(ev: Event): void;
  onClose?(ev: CloseEvent): void;
  onError?(ev: Event | ErrorEvent): void;
}

export class ModelController implements ReactiveController {
  host: RemoteModelHost;
  wsUrl: string;
  private conn?: WebSocket;
  maxSize = 60000;
  sequence = 0;
  queue = new Map;

  constructor(host: RemoteModelHost, url?: string) {
    (this.host = host).addController(this);
    this.wsUrl = url ?? "";
  }

  hostDisconnected() {
    this.disconnect();
  }

  invoke(method: string, ...params: unknown[]): Promise<unknown> {
    if (this.conn == null || this.conn.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("disconnected"));
    }
    const rpc = {
      method,
      params,
      jsonrpc: "2.0",
      id: this.sequence++,
    };
    let cmd = JSON.stringify(rpc);
    const later = new Promise((resolve, reject) => {
      this.queue.set(rpc.id, [resolve, reject]);
    });
    this.conn!.send(cmd);
    return later;
  }

  notify(method: string, ...params: unknown[]) {
    const rpc = {
      method,
      params,
      jsonrpc: "2.0",
    };
    this.conn?.send(JSON.stringify(rpc));
  }
  
  streaming(data: ArrayBuffer) {
    if (!this.conn) throw new Error("disconnected");
    if (data.byteLength > this.maxSize) throw new Error(`data block is too big > ${this.maxSize}`);
    this.conn.send(data);
    // const total = data.byteLength;
    // if (total < this.maxSize) return this.conn.send(data);
    // let offset = 0;
    // while (offset < total) {
    //   const length = Math.min(this.maxSize, total - offset);
    //   const block = new DataView(data, offset, length);
    //   offset += length;
    //   this.conn.send(block);
    // }
  }

  multicast(value: unknown, path?: string) {
    if (!this.conn) throw new Error("disconnected");
    this.notify("MULTICAST", value, path ?? ".");
  }

  broadcast(value: unknown, path?: string) {
    if (!this.conn) throw new Error("disconnected");
    this.notify("BROADCAST", value, path ?? ".");
  }

  connect(url?: string) {
    url = url ?? this.wsUrl;
    this.disconnect();
    this.conn = new WebSocket(url);
    this.conn.binaryType = "arraybuffer";
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
    if (ev.data instanceof ArrayBuffer) {
      // const idData = await ev.data.slice(0, 4).arrayBuffer();
      // const id = new Uint32Array(idData);
      // const data = await ev.data.slice(4).arrayBuffer();
      if (this.host.onStreaming)
        return this.host.onStreaming(ev.data);
    }
    const data: RpcRequest | RpcResponse = JSON.parse(ev.data);
    if (isRpcRequest(data)) {
      switch (data.method) {
        case "UPDATE": {
          if (this.host.onUpdate && Array.isArray(data.params)) {
            const value = data.params[3];
            const path = data.params[2] as string;
            this.host.onUpdate(value, path);
          }
          break;
        }
        case "MULTICAST": {
          if (this.host.onMulticast) this.host.onMulticast(data.params);
          break;
        }
      }
    } else {
      if (data.id !== undefined) return this.on_response(data);
      if (this.host.onUpdate && data.id) {
        this.host.onUpdate(data.result, data.id as string);
      }
    }
  }

  private on_response(data: RpcResponse) {
    const promise = this.queue.get(data.id);
    if (promise == null) throw new Error(`Unknown response ${data}`);
    this.queue.delete(data.id);
    const [resolve, reject] = promise;
    if (data.error != null) {
      reject(new JsonRpcError(data.error));
    } else {
      resolve(data.result);
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
  jsonrpc: "2.0";
  method: string;
  params?: Array<unknown> | Record<string, unknown>;
  id?: string | number;
}

export interface RpcResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: ErrorData;
  id: string | number | null;
}

export interface ErrorData {
  code: number;
  message: string;
  data?: unknown;
}

export class JsonRpcError extends Error {
  code: number;
  data?: unknown;
  constructor(errData: ErrorData) {
    super(errData.message);
    this.code = errData.code;
    this.data = errData.data;
    this.name = "JSONRPC 2.0 Error";
  }
}