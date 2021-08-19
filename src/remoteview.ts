import {LitElement} from "lit";
import {property} from "lit/decorators.js";
import {ModelController, RemoteModelHost} from "./model-controller.js";

export function makeModelUrl(
  urlOrPath: string,
  modelName: string,
  host?: string,
  port?: string
): string {
  if (!host) {
    host = `${window.location.protocol === "https:" ? "wss://" : "ws://"}${
      window.location.hostname
    }`;
  }
  if (!port) port = window.location.port;
  if (port) {
    host = `${host}:${port}`;
  }
  return `${host}${urlOrPath}/${modelName}`;
}

export abstract class RemoteModelBase
  extends LitElement
  implements RemoteModelHost
{
  // Create the controller and store it
  @property()
  modelUrl = "";
  @property()
  wsPath = "/ws/model";
  @property()
  modelName = "todolist";
  @property()
  remoteHost = "";
  @property()
  remotePort = "8060";

  protected model: ModelController;

  constructor() {
    super();
    this.model = new ModelController(this, this.modelUrl);
  }

  connectedCallback() {
    if (!this.modelUrl) {
      this.modelUrl = makeModelUrl(
        this.wsPath,
        this.modelName,
        this.remoteHost,
        this.remotePort
      );
    }
    console.log("websocket url:", this.modelUrl);
    this.model.wsUrl = this.modelUrl;
    this.model.connect();
    super.connectedCallback();
  }
}

export function getValue(data: any, path?: string): any {
  if (path == null || path === "$" || path === ".") return data;
  traverse(data, path.split("."))[2];
}

export function traverse(data: any, path: string[]): any {
  while (path[0] === "$" || path[0] === "") path.shift();
  const r = /([^\[]*)(\[(\d+)\])?/;
  let parent = data;
  let v = data;
  let idx = undefined;
  for (const key of path) {
    const arr = key.match(r);
    if (!arr)
      throw new Error(`failed to parse path: ${path}`);
    if (arr[1] != undefined && arr[1] !== "") {
      idx = arr[1]
      parent = v;
      v = v[idx];
    }
    if (arr[3] != undefined) {
      idx = arr[3];
      parent = v;
      v = v[idx];
    }
  }
  return [parent, idx, v];
}

export function putValue(
  data: unknown,
  newValue: unknown,
  path?: string
): any {
  if (path == null || path === "$" || path === ".") {
    if (newValue !== undefined) data = newValue;
    return data;
  }
  const segments = path.split(".");
  let [branch, leaf] = traverse(data, segments);
  branch[leaf] = newValue;
  return data;
}
