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
  remotePort = "8080";

  protected model: ModelController;

  constructor() {
    super();
    if (!this.modelUrl) {
      this.modelUrl = makeModelUrl(
        this.wsPath,
        this.modelName,
        this.remoteHost,
        this.remotePort
      );
    }
    this.model = new ModelController(this, this.modelUrl);
  }
}

export function getValue(data: any, path?: string): any {
  if (path == null || path === "$" || path === ".") return data;
  traverse(data, path.split("."));
}

export function traverse(data: any, path: string[]): any {
  while (path[0] === "$" || path[0] === "") path.shift();
  if (!path.length) return data;
  const r = /([^\[]+)(\[(\d+)\])?/;
  let v = data;
  for (const key of path) {
    const arr = key.match(r);
    if (!arr || arr[1] == undefined)
      throw new Error(`failed to parse path: ${path}`);
    v = v[arr[1]];
    if (arr[3] != undefined) v = v[arr[3]];
  }
  return v;
}

export function putValue(
  data: unknown,
  newValue: unknown,
  path?: string
): unknown {
  if (path == null || path === "$" || path === ".") {
    if (newValue === undefined) data = newValue;
    return data;
  }
  const segments = path.split(".");
  while (segments[0] === "$" || segments[0] === "") segments.shift();
  const leaf = segments.pop();
  if (leaf == undefined) {
    data = newValue;
    return data;
  }
  let branch = traverse(data, segments);
  branch[leaf] = newValue;
  return data;
}
