import { LitElement, html } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import { ModelController, RemoteModelHost } from './model-controller.js';
import { RemoteCommand, VideoSource } from './videocaster.js';

@customElement('video-viewer')
export class VideoViewer extends LitElement implements RemoteModelHost {
    // Create the controller and store it
    model = new ModelController(this, "ws://127.0.0.1:8080/ws/model/todolist");
    private source?: VideoSource;
    private mediaSource?: MediaSource;
    private buffers: ArrayBuffer[] = [];
    private sourceBuffer?: SourceBuffer;
    private started = false;
    maxDiff = 5;

    render() {
        return html`
<h2>同步播放观众端</h2>
<video id=videoPlayer ></video>
        `;
    }

    @query('#videoPlayer')
    videoPlayer!: HTMLVideoElement;

    onMulticast(data: unknown[]) {
        const { command, param } = data[0] as RemoteCommand;
        switch (command) {
            case "prepare":
                return this.loadVideo(param as VideoSource);
            case "play":
                return this.videoPlayer.play().then(() => {});
            case "pause":
                return this.videoPlayer.pause();
            case "sync":{
                const hostTime = param as number;
                let lag = Math.abs(this.videoPlayer.currentTime - hostTime);
                if (lag > this.maxDiff) {
                    this.videoPlayer.currentTime = hostTime;
                    this.sourceBuffer!.abort();
                }
                break;
            }
            case "controls":
                return this.setControls(param as number);
            default: throw new Error(`unknown command: ${data}`);
        }
    }

    setControls(param: number | boolean) {
        this.videoPlayer.controls = !!param;
        this.requestUpdate();
    }


    loadVideo(source: VideoSource) {
        if (!this.videoPlayer) return;
        this.source = source;
        this.mediaSource = new MediaSource;
        this.mediaSource.addEventListener('sourceopen', () => this.onSourceOpen());
        this.videoPlayer.src = URL.createObjectURL(this.mediaSource);
        this.requestUpdate();
    }

    onSourceOpen() {
        console.log("open viewver video:", this.source);
        // const mimeCodec = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'
        this.sourceBuffer = this.mediaSource!.addSourceBuffer(this.source!.type);
        this.sourceBuffer.addEventListener('updateend', () => this.tryUpdate());
        if (!this.started && this.buffers.length) {
            this.started = true;
            this.sourceBuffer.appendBuffer(this.buffers.shift()!);
        }
    }

    tryUpdate() {
        const data = this.buffers.shift();
        if (data !== undefined) {
            try {
                this.sourceBuffer!.appendBuffer(data);
            } catch (e) {
                console.trace(e);
            }
        }
    }

    async onStreaming(data: ArrayBuffer | Blob) {
        if (data instanceof Blob) {
            data = await data.arrayBuffer();
        }
        this.buffers.push(data);
        if (!this.started && this.buffers.length && this.sourceBuffer) {
            this.started = true;
            this.sourceBuffer.appendBuffer(this.buffers.shift()!);
        }
    }
}
