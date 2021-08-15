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

    render() {
        return html`
<h2>同步播放观众端</h2>
<video id=videoPlayer controls></video>
        `;
    }

    @query('#videoPlayer')
    videoPlayer!: HTMLVideoElement;

    async onMulticast(data: unknown[]) {
        const { command, param: args } = data[0] as RemoteCommand;
        switch (command) {
            case "prepare":
                return this.loadVideo(args as VideoSource);
            case "play":
                return await this.playVideo(args as number);
            case "pause":
                this.videoPlayer.pause();
                return;
            case "stop":
            default: throw new Error(`unknown command: ${data}`);
        }
    }

    async playVideo(offset?: number) {
        if (offset != null) this.videoPlayer.currentTime = offset;
        await this.videoPlayer.play();
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
        this.sourceBuffer = this.mediaSource!.addSourceBuffer(this.source!.type);
        this.buffers.forEach(data => this.sourceBuffer?.appendBuffer(data));
        this.buffers = [];
    }

    async onStreaming(data: ArrayBuffer | Blob) {
        if (data instanceof Blob) {
            data = await data.arrayBuffer();
        }
        if (this.sourceBuffer) {
            this.sourceBuffer.appendBuffer(data);
        } else {
            this.buffers.push(data);
        }
    }
}
