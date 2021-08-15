import { LitElement, html } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import { ModelController, RemoteModelHost } from './model-controller.js';

@customElement('video-caster')
export class Videocaster extends LitElement implements RemoteModelHost {
    // Create the controller and store it
    private model = new ModelController(this, "ws://127.0.0.1:8080/ws/model/todolist");
    private mediaSource!: MediaSource;
    private mediaFile!: File;
    private sourceBuffer!: SourceBuffer;
    bufferSize = 4_000_000;
    bufferDuration = 0;
    private bufferRange = [0, 0];

    onUpdate(_data: any, _path?: string) {
    }

    render() {
        return html`
<h2>同步播放</h2>
<video id=videoPlayer controls @timeupdate=${this.onTimeUpdate} @canplay=${this.onCanPlay} @seeking=${this.onSeeking} ></video>
<br/>
<input type="file" id="videoFile" name="selectFile"/>
<button @click=${this.playVideo}>播放视频</button>

        `;
    }

    @query('#videoFile')
    videoFile!: HTMLInputElement;

    @query('#videoPlayer')
    videoPlayer!: HTMLVideoElement;

    refresh() {
        this.model.getData();
    }

    playVideo() {
        if (!this.videoPlayer || !this.videoFile || this.videoFile.value == "") return;
        this.mediaFile = this.videoFile.files![0];
        this.mediaSource = new MediaSource;
        this.mediaSource.addEventListener('sourceopen', async () => this.onSourceOpen());
        this.videoPlayer.src = URL.createObjectURL(this.mediaSource);
        this.requestUpdate();
    }

    async onSourceOpen() {
        console.log("open video:", this.mediaFile);
        this.sourceBuffer = this.mediaSource!.addSourceBuffer(this.mediaFile!.type);
        await this.fillBuffer(0);
    }

    async onCanPlay() {
        this.bufferDuration = this.videoPlayer.duration / this.mediaFile.size * this.bufferSize;
        console.log("durations:", this.videoPlayer.duration, this.bufferDuration);
        await this.videoPlayer.play();
    }

    async onTimeUpdate() {
        const [low, high] = this.bufferRange;
        if (high > 0 && high < low + this.bufferSize) {  // no more data
            return;
        }
        const size = this.mediaFile.size;
        let position = this.videoPlayer.currentTime / this.videoPlayer.duration * size;
        if (position < low || position > high || high === 0) {  // seeking?
            await this.fillBuffer(position);
            return;
        }
        const rate = (position - low)/this.bufferSize;
        if (rate > 0.5) {
            await this.fillBuffer(this.bufferRange[1]);
        }
    }

    onSeeking(e: Event) {
        console.log(e);
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
            this.sourceBuffer.appendBuffer(chunk);
            console.log('fetch next chunk:', this.bufferRange);
        }
    }
}
