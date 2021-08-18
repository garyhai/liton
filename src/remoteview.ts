import {LitElement} from 'lit';
import {property} from 'lit/decorators.js';
import {ModelController, RemoteModelHost} from './model-controller.js';
import jp from 'jsonpath';

export function makeModelUrl(
  urlOrPath: string,
  modelName: string,
  host?: string,
  port?: string
): string {
  if (!host) {
    host = `${window.location.protocol === 'https:' ? 'wss://' : 'ws://'}${
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
  modelUrl = '';
  @property()
  wsPath = '/ws/model';
  @property()
  modelName = 'todolist';
  @property()
  remoteHost = '';
  @property()
  remotePort = '8080';

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

export function getValue(data: unknown, path: string): unknown {
  if (path == null || path === '$' || path === '.') return data;
  if (path.startsWith('.')) path = '$' + path;
  return jp.value(data, path);
}

export function putValue(
  data: unknown,
  newValue: unknown,
  path?: string
): unknown {
  if (path == null || path === '$' || path === '.') {
    if (newValue === undefined) data = newValue;
    return data;
  }
  if (!path.startsWith('$')) path = '$.' + path;
  return jp.value(data, path, newValue);
}
