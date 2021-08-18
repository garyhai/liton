import { html } from 'lit';
import { customElement, query, property, state } from 'lit/decorators.js';
import { putValue, RemoteModelBase } from './remoteview.js';

export interface RemoteCommand {
    command: string;
    param?: number | VideoSource;
}

export interface VideoSource {
    name: string;
    type: string;
    size: number;
    lastModified: number;
}

function isSameSource(s1: VideoSource | undefined, s2: VideoSource | undefined): boolean {
    if (s1 == s2) return true;
    return (!!s1 && !!s2 && s1.name == s2.name &&
        s1.lastModified == s2.lastModified &&
        s1.size == s2.size && s1.type == s2.type);
}

export interface VideoModel {
    sync: boolean;
    syncing: number;
    syncInterval: number;
    playing: boolean;
    autoplay: boolean;
    controls: boolean;
    loop: boolean;
    muted: boolean;
    pip: boolean;
    bufferTime: number;
    fullScreen: boolean;
    source?: VideoSource;
    duration?: number;
    width?: number;
    height?: number;
}

const MIN_BUFFER_SIZE = 2_000_000;
const MAX_GAP = 1;
@customElement('sync-player')
export class SyncPlayer extends RemoteModelBase {
    private mediaSource?: MediaSource;
    private mediaFile?: File;
    private sourceBuffer?: SourceBuffer;
    private buffers: ArrayBuffer[] = [];
    private bufferRange = [0, 0];
    private bufferSize = MIN_BUFFER_SIZE;
    private received = 0;
    private canPlay = false;
    private toPlay = false;
    private isCaster = false;

    @property({ type: Boolean })
    isHost = false;
    @property({ type: Number })
    maxGap = MAX_GAP;


    @state()
    private vPlayer: VideoModel = {
        duration: 0,
        sync: true,
        syncInterval: 20,
        playing: false,
        syncing: 0,
        autoplay: false,
        controls: true,
        loop: false,
        muted: false,
        pip: false,
        fullScreen: false,
        bufferTime: 20,
    }

    onUpdate(data: unknown, path?: string) {
        console.log("virtual player is changed: ", data, path);
        const { playing, syncing, fullScreen, source } = this.vPlayer;
        putValue(this.vPlayer, data, path);
        if (!isSameSource(this.vPlayer.source, source)) {
            this.remoteLoadVideo();
        }
        if (this.vPlayer.playing !== playing) {
            if (playing) {
                this.videoPlayer.pause();
            } else if (this.canPlay) {
                this.onCanPlay();
            } else {
                this.toPlay = true;
            }
        }
        if (this.vPlayer.sync && (this.vPlayer.syncing !== syncing)) {
            this.syncSeek();
        }
        // if (this.vPlayer.pip !== pip) {
        //     if (pip) {

        //     } else {
        //         this.videoPlayer.requestPictureInPicture().catch(e => console.error());
        //     }
        // }
        if (this.vPlayer.fullScreen !== fullScreen) {
            if (fullScreen && document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                const controls = this.vPlayer.controls ? "show" : "hide";
                this.videoPlayer.requestFullscreen({ navigationUI: controls })
                    .catch(e => console.error("failed to switch fullscreen mode: ", e));
            }
        }
        this.requestUpdate();
    }

    render() {
        if (this.isHost) {
            return html`
                <h2>同步播放主持人端</h2>
                <video id=videoPlayer
                    controls
                    ?muted=${this.vPlayer.muted}
                    ?loop=${this.vPlayer.loop}
                    ?autoplay=${this.vPlayer.autoplay}
                    @timeupdate=${this.onTimeUpdate}
                    @canplay=${this.onCanPlay}
                    @seeking=${this.onSeeking}
                    @play=${this.onHostPlay}
                    @pause=${this.pauseVideo}>
                </video>
                <label>
                    <input type="file" id="videoFile" name="selectFile"
                        @change=${this.localLoadVideo}>
                </label>
                <label>
                    <input type="checkbox"
                        ?checked=${this.vPlayer.controls}
                        @change=${this.setViewerControls}>
                    允许远端控制
                </label>
            `;
        } else {
            return html`
                <h2>同步播放观众端</h2>
                <video id=videoPlayer
                    ?controls=${this.vPlayer.controls}
                    ?muted=${this.vPlayer.muted}
                    ?loop=${this.vPlayer.loop}
                    ?autoplay=${this.vPlayer.autoplay}
                >
                </video>
                <h3>已收到的数据长度：${this.received}</h3>
            `;
        }
    }

    @query('#videoFile')
    videoFile!: HTMLInputElement;

    @query('#videoPlayer')
    videoPlayer!: HTMLVideoElement;

    closeVideo() {
        try {
            this.sourceBuffer?.abort();
            this.mediaSource?.endOfStream();
        } catch (e) {
            console.error("exception when video closing:", e);
        }
        this.mediaSource = undefined;
        this.sourceBuffer = undefined;
        this.mediaFile = undefined;
        this.bufferRange = [0, 0];
        this.canPlay = false;
        this.toPlay = false;
        this.isCaster = false;
        this.buffers = [];
        this.received = 0;
    }

    setViewerControls(ev: Event) {
        const controls = (ev.target as HTMLInputElement).checked;
        this.model.setData(controls, "controls");
    }

    syncSeek() {
        const { syncing } = this.vPlayer;
        const gap = Math.abs(this.videoPlayer.currentTime - syncing);
        if (gap > this.maxGap) {
            console.log("sync the gap:", gap);
            this.videoPlayer.currentTime = syncing;
        }
    }

    onHostPlay() {
        this.vPlayer.playing = true;
        this.model.setData(true, "playing");
    }

    onCanPlay() {
        this.canPlay = true;
        if (this.isCaster) {
            this.vPlayer.duration = this.videoPlayer.duration;
            const bs = (this.vPlayer.bufferTime / this.vPlayer.duration) * this.vPlayer.source!.size;
            this.bufferSize = Math.max(bs, MIN_BUFFER_SIZE);
        } else if (this.toPlay) {
            this.videoPlayer.play()
                .then(() => this.toPlay = false)
                .catch(e => console.error("failed to play video:", e));
        }
    }

    pauseVideo() {
        this.videoPlayer.pause();
        if (this.isHost) {
            this.vPlayer.playing = false;
            this.model.setData(false, "playing");
        }
    }

    localLoadVideo() {
        this.closeVideo();
        if (!this.videoPlayer || !this.videoFile || this.videoFile.value == "") return;
        this.isCaster = true;
        this.mediaFile = this.videoFile.files![0];
        const { name, size, type, lastModified } = this.mediaFile;
        const fileSource = { name, size, type, lastModified }
        this.vPlayer.source = fileSource;
        this.mediaSource = new MediaSource;
        this.mediaSource.addEventListener('sourceopen', () => this.onSourceOpen());
        this.videoPlayer.src = URL.createObjectURL(this.mediaSource);
        this.canPlay = false;
        this.model.setData(fileSource, "source");
        this.requestUpdate();
    }

    remoteLoadVideo() {
        this.closeVideo();
        if (this.vPlayer.source == null) return;
        this.mediaSource = new MediaSource;
        this.mediaSource.addEventListener('sourceopen', () => this.onSourceOpen());
        this.videoPlayer.src = URL.createObjectURL(this.mediaSource);
        this.requestUpdate();
    }

    async onSourceOpen() {
        // const mimeCodec = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
        // this.sourceBuffer = this.mediaSource!.addSourceBuffer(mimeCodec);
        this.sourceBuffer = this.mediaSource!.addSourceBuffer(this.mediaFile!.type);
        this.sourceBuffer.addEventListener('updateend', () => this.doBuffer());
        await this.fillBuffer(0);
    }

    doBuffer(data?: ArrayBuffer) {
        if (data && this.buffers.length) {
            this.buffers.push(data);
            data = undefined;
        }
        while (this.sourceBuffer && !this.sourceBuffer.updating) {
            if (!data) data = this.buffers.shift();
            if (!data) break;
            this.sourceBuffer!.appendBuffer(data);
            data = undefined;
        }
    }

    async fillBuffer(position: number) {
        if (this.mediaFile && this.sourceBuffer) {
            const length = Math.min(this.mediaFile.size - position, this.bufferSize);
            const blob = this.mediaFile.slice(position, position + length);
            const chunk = await blob.arrayBuffer();
            this.bufferRange = [position, position + chunk.byteLength];
            this.doBuffer(chunk);
            this.model.streaming(chunk);
        }
    }

    async onStreaming(data: ArrayBuffer | Blob) {
        if (data instanceof Blob) {
            data = await data.arrayBuffer();
        }
        if (!this.isCaster) {
            this.received += data.byteLength;
            this.doBuffer(data);
        } else {
            console.error("received unexpected streaming data as a caster");
        }
    }

    async onTimeUpdate() {
        if (!this.isCaster) return;
        if (this.videoPlayer.currentTime % this.vPlayer.syncInterval) {
            this.vPlayer;
        }
        const [low, high] = this.bufferRange;
        if (high > 0 && high < (low + this.bufferSize)) {  // no more data
            return;
        }
        const size = this.mediaFile!.size;
        const position = this.videoPlayer.currentTime / this.videoPlayer.duration * size;
        const rate = (position - low) / this.bufferSize;
        if (rate > 0.5) {
            console.log(position, this.videoPlayer.currentTime);
            await this.fillBuffer(high);
        }
    }

    onSeeking() {
        if (!this.mediaSource || !this.sourceBuffer) return;
        if (this.mediaSource.readyState === 'open') {
            // this.sourceBuffer.abort();
            console.log(this.mediaSource.readyState);
        } else {
            console.log('seek but not open?');
            console.log(this.mediaSource.readyState);
            return;
        }
        const info = {
            command: "sync",
            param: this.videoPlayer.currentTime,
        }
        this.model.multicast(info);
    }
}
