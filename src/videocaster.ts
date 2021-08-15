import { LitElement, html } from 'lit';
import { customElement, query, property } from 'lit/decorators.js';
import { ModelController, RemoteModelHost } from './model-controller.js';

export interface RemoteCommand {
    command: string;
    param?: number | VideoSource;
}

export interface VideoSource {
    name: string;
    type: string;
    size: number;
}

@customElement('video-caster')
export class Videocaster extends LitElement implements RemoteModelHost {
    // Create the controller and store it
    private model = new ModelController(this, "ws://127.0.0.1:8080/ws/model/todolist");
    private mediaSource?: MediaSource;
    private mediaFile?: File;
    private sourceBuffer?: SourceBuffer;
    bufferSize = 2_000_000;
    private bufferRange = [0, 0];

    @property({ type: Boolean })
    canPlay = false;

    render() {
        return html`
<h2>同步播放主持人端</h2>
<video id=videoPlayer controls @timeupdate=${this.onTimeUpdate} @canplay=${this.onCanPlay} @seeking=${this.onSeeking} ></video>
<br/>
<input type="file" id="videoFile" name="selectFile" @change=${this.loadVideo} />
<button ?disabled=${!this.canPlay} @click=${this.playVideo}>播放视频</button>

        `;
    }

    @query('#videoFile')
    videoFile!: HTMLInputElement;

    @query('#videoPlayer')
    videoPlayer!: HTMLVideoElement;

    async playVideo() {
        const command = {
            command: "play",
        }
        this.model.multicast(command);
        await this.videoPlayer.play();
    }

    loadVideo() {
        if (!this.videoPlayer || !this.videoFile || this.videoFile.value == "") return;
        this.mediaFile = this.videoFile.files![0];
        const { name, size, type } = this.mediaFile;
        const info = {
            command: "prepare",
            param: { name, size, type }
        }
        this.model.multicast(info);
        this.mediaSource = new MediaSource;
        this.mediaSource.addEventListener('sourceopen', async () => this.onSourceOpen());
        this.videoPlayer.src = URL.createObjectURL(this.mediaSource);
        this.canPlay = false;
        this.requestUpdate();
    }

    async onSourceOpen() {
        this.sourceBuffer = this.mediaSource!.addSourceBuffer(this.mediaFile!.type);
        await this.fillBuffer(0);
    }

    onCanPlay() {
        this.canPlay = true;
    }

    async onTimeUpdate() {
        const [low, high] = this.bufferRange;
        if (high > 0 && high < low + this.bufferSize) {  // no more data
            return;
        }
        const size = this.mediaFile!.size;
        let position = this.videoPlayer.currentTime / this.videoPlayer.duration * size;
        if (position < low || position > high || high === 0) {  // seeking?
            await this.fillBuffer(position);
            return;
        }
        const rate = (position - low) / this.bufferSize;
        if (rate > 0.5) {
            await this.fillBuffer(this.bufferRange[1]);
        }
    }

    onSeeking() {
        if (!this.mediaSource || !this.sourceBuffer) return;
        if (this.mediaSource.readyState === 'open') {
            this.sourceBuffer.abort();
            console.log(this.mediaSource.readyState);
        } else {
            console.log('seek but not open?');
            console.log(this.mediaSource.readyState);
        }
    }

    private async fillBuffer(position: number) {
        if (this.mediaFile && this.sourceBuffer) {
            const length = Math.min(this.mediaFile.size - position, this.bufferSize);
            const blob = this.mediaFile.slice(position, position + length);
            const chunk = await blob.arrayBuffer();
            this.bufferRange = [position, position + chunk.byteLength];
            console.log("fetch chunk data: ", this.bufferRange, chunk.byteLength);
            this.sourceBuffer.appendBuffer(chunk);
            this.model.streaming(chunk);
        }
    }
}
