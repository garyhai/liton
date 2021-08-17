import { html } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { RemoteModelBase } from './remoteview.js';
import { RemoteCommand, VideoSource } from './videocaster.js';

@customElement('video-viewer')
export class VideoViewer extends RemoteModelBase {
    private source?: VideoSource;
    private mediaSource?: MediaSource;
    private buffers: ArrayBuffer[] = [];
    private sourceBuffer?: SourceBuffer;
    // private started = false;
    @property({ type: Number })
    maxLag = 3;

    @property({ type: Number })
    chunkCounter = 0;

    @property({ type: Number })
    totalSize = 0;

    render() {
        return html`
<h2>同步播放观众端</h2>
<video id=videoPlayer controls></video>
<h3>收到的块数：${this.chunkCounter}, 总大小: ${this.totalSize}</h3>
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
                return this.videoPlayer.play().then(() => { });
            case "pause":
                return this.videoPlayer.pause();
            case "sync": {
                const hostTime = param as number;
                let lag = Math.abs(this.videoPlayer.currentTime - hostTime);
                if (lag > this.maxLag) {
                    console.log("lagged: ", lag);
                    this.videoPlayer.currentTime = hostTime;
                    // this.sourceBuffer!.abort();
                }
                break;
            }
            case "controls":
                return this.setControls(param as number);
            default: throw new Error(`unknown command: ${data}`);
        }
    }

    setControls(param: number | boolean) {
        console.log("set controls:", !!param, param);
        this.videoPlayer.controls = !!param;
    }

    closeVideo() {
        this.sourceBuffer?.abort();
        this.mediaSource?.endOfStream()
        this.mediaSource = undefined;
        this.sourceBuffer = undefined;
        this.buffers = [];
    }

    loadVideo(source: VideoSource) {
        this.closeVideo();
        this.source = source;
        this.mediaSource = new MediaSource;
        this.mediaSource.addEventListener('sourceopen', () => this.onSourceOpen());
        this.videoPlayer.src = URL.createObjectURL(this.mediaSource);
        this.requestUpdate();
    }

    onSourceOpen() {
        console.log("open viewver video:", this.source);
        const mimeCodec = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'
        this.sourceBuffer = this.mediaSource!.addSourceBuffer(mimeCodec);//this.source!.type);
        this.sourceBuffer.addEventListener('updateend', () => this.tryUpdate());
        this.tryUpdate();
    }

    tryUpdate() {
        while (!this.sourceBuffer?.updating) {
            const data = this.buffers.shift();
            if (data === undefined) break;
            this.sourceBuffer!.appendBuffer(data);
        }
    }

    async onStreaming(data: ArrayBuffer | Blob) {
        this.chunkCounter++;
        if (data instanceof Blob) {
            data = await data.arrayBuffer();
        }
        this.totalSize += data.byteLength;

        this.buffers.push(data);
        this.tryUpdate();
    }
}
