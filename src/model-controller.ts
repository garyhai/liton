import {ReactiveController, ReactiveControllerHost} from "lit";

export function isRpcRequest(
  data: RpcRequest | RpcResponse
): data is RpcRequest {
  return (data as RpcRequest).method !== undefined;
}

export interface RemoteModelHost extends ReactiveControllerHost {
  onUpdate?(data: unknown, path?: string): void;
  onNotify?(action: string, data: unknown, path?: string): void;
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
  sequence = 1;
  queue = new Map();

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

  getData(path?: string): Promise<unknown> {
    return this.invoke("GET", path ?? ".");
  }

  setData(value: unknown, path?: string) {
    if (this.conn == null || this.conn.readyState !== WebSocket.OPEN) {
      throw new Error("disconnected");
    }
    return this.notify("SET", value, path ?? ".");
  }

  deleteData(path?: string) {
    if (this.conn == null || this.conn.readyState !== WebSocket.OPEN) {
      throw new Error("disconnected");
    }
    return this.notify("DEL", path ?? ".");
  }

  notify(method: string, ...params: unknown[]) {
    const rpc = {
      method,
      params,
      jsonrpc: "2.0",
    };
    this.conn?.send(JSON.stringify(rpc));
  }

  buffering(data: Blob, id: number, offset?: number) {
    if (!this.conn) throw new Error("disconnected");
    offset ??= 0;
    let sent = 0;
    let rest = data.size;
    do {
      const head = new DataView(new ArrayBuffer(8));
      head.setUint32(0, id);
      head.setUint32(4, offset);
      let length = Math.min(rest, this.maxSize);
      const block = new Blob([head, data.slice(sent, sent + length)]);
      this.conn.send(block);
      sent += length;
      rest -= length;
      offset += length;
    } while (rest > 0);
  }

  streaming(data: ArrayBuffer) {
    if (!this.conn) throw new Error("disconnected");
    if (data.byteLength > this.maxSize)
      throw new Error(`data block is too big > ${this.maxSize}`);
    this.conn.send(data);
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
      if (this.host.onStreaming) this.host.onStreaming(ev.data);
      return;
    }
    const data: RpcRequest | RpcResponse = JSON.parse(ev.data);
    if (isRpcRequest(data)) {
      switch (data.method) {
        case "NOTIFY": {
          if (Array.isArray(data.params)) {
            const [action, , path, value] = data.params as any;
            this.handle_notify(action, path, value);
          } else {
            const {action, path, value} = data.params as any;
            this.handle_notify(action, path, value);
          }
          break;
        }
        case "MULTICAST": {
          if (this.host.onMulticast) this.host.onMulticast(data.params);
          break;
        }
      }
    } else {
      return this.handle_response(data);
    }
  }

  private handle_notify(action: string, path: string, data?: unknown[]) {
    switch (action) {
      case "JSON.SET":
        if (this.host.onUpdate) this.host.onUpdate(data, path);
        break;
      case "JSON.DEL":
        if (this.host.onUpdate) this.host.onUpdate(undefined, path);
        break;
      default:
        if (this.host.onNotify) this.host.onNotify(action, data, path);
    }
  }

  private handle_response(data: RpcResponse) {
    if (data.id == undefined) {
      console.warn("received response without ID", data);
      return;
    }
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
    this.queue.forEach(([, reject]) => reject(new Error("disconnected")));
    this.queue.clear();
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
