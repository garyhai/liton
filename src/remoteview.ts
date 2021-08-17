import { LitElement, } from 'lit';
import { property } from 'lit/decorators.js';
import { ModelController, RemoteModelHost } from './model-controller.js';

export abstract class RemoteModelBase extends LitElement implements RemoteModelHost {
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
            this.modelUrl = makeModelUrl(this.wsPath, this.modelName, this.remoteHost, this.remotePort);
        }
        this.model = new ModelController(this, this.modelUrl);
    }
}

export function makeModelUrl(url_or_path: string, modelName: string, host?: string, port?: string): string {
    if (!host) {
        host = `${(window.location.protocol === 'https:' ? 'wss://' : 'ws://')}${window.location.hostname}`;
    }
    if (!port) port = window.location.port;
    if (port) {
        host = `${host}:${port}`;
    }
    return `${host}${url_or_path}/${modelName}`;
}
