import {html} from "lit";
import {customElement, query, property} from "lit/decorators.js";
import {RemoteModelBase} from "./remoteview.js";

export interface RemoteCommand {
  command: string;
  param?: number | VideoSource;
}

export interface VideoSource {
  name: string;
  type: string;
  size: number;
}

@customElement("video-caster")
export class Videocaster extends RemoteModelBase {
  private mediaSource?: MediaSource;
  private mediaFile?: File;
  private sourceBuffer?: SourceBuffer;
  private bufferRange = [0, 0];
  bufferSize = 2_000_000;
  syncInterval = 20;

  @property({type: Number})
  chunkCounter = 0;

  @property({type: Number})
  totalSize = 0;

  @property({type: Boolean})
  canPlay = false;

  @property({type: Boolean})
  viewerControls = true;

  render() {
    return html`
      <h2>同步播放主持人端: multcast 实现</h2>
      <video
        id="videoPlayer"
        controls
        @timeupdate=${this.onTimeUpdate}
        @canplay=${this.onCanPlay}
        @seeking=${this.onSeeking}
        @play=${this.playVideo}
        @pause=${this.pauseVideo}
      ></video>
      <br />
      <input
        type="file"
        id="videoFile"
        name="selectFile"
        @change=${this.loadVideo}
      />
      <label
        ><input
          type="checkbox"
          ?checked=${this.viewerControls}
          @change=${this.setViewerControls}
        />允许远端控制</label
      >
      <h3>收到的块数：${this.chunkCounter}, 总大小: ${this.totalSize}</h3>
    `;
  }

  @query("#videoFile")
  videoFile!: HTMLInputElement;

  @query("#videoPlayer")
  videoPlayer!: HTMLVideoElement;

  closeVideo() {
    this.sourceBuffer?.abort();
    this.mediaSource?.endOfStream();
    this.mediaSource = undefined;
    this.sourceBuffer = undefined;
    this.mediaFile = undefined;
    this.bufferRange = [0, 0];
  }

  setViewerControls(ev: Event) {
    this.viewerControls = (ev.target as HTMLInputElement).checked;
    console.log("set controls to:", this.viewerControls);
    const command = {
      command: "controls",
      param: this.viewerControls ? 1 : 0,
    };
    this.model.multicast(command);
  }

  async playVideo() {
    const command = {
      command: "play",
    };
    this.model.multicast(command);
    await this.videoPlayer.play();
  }

  pauseVideo() {
    const command = {
      command: "pause",
    };
    this.model.multicast(command);
    this.videoPlayer.pause();
  }

  loadVideo() {
    this.closeVideo();
    if (!this.videoPlayer || !this.videoFile || this.videoFile.value == "")
      return;
    this.mediaFile = this.videoFile.files![0];
    const {name, size, type} = this.mediaFile;
    const info = {
      command: "prepare",
      param: {name, size, type},
    };
    this.model.multicast(info);
    this.mediaSource = new MediaSource();
    this.mediaSource.addEventListener("sourceopen", async () =>
      this.onSourceOpen()
    );
    this.videoPlayer.src = URL.createObjectURL(this.mediaSource);
    this.canPlay = false;
    this.requestUpdate();
  }

  async onSourceOpen() {
    const mimeCodec = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
    this.sourceBuffer = this.mediaSource!.addSourceBuffer(mimeCodec); //this.mediaFile!.type);
    await this.fillBuffer(0);
  }

  onCanPlay() {
    this.canPlay = true;
  }

  async onTimeUpdate() {
    if (this.videoPlayer.currentTime % this.syncInterval) {
      const info = {
        command: "sync",
        param: this.videoPlayer.currentTime,
      };
      this.model.multicast(info);
    }
    const [low, high] = this.bufferRange;
    if (high > 0 && high < low + this.bufferSize) {
      // no more data
      return;
    }
    const size = this.mediaFile!.size;
    const position =
      (this.videoPlayer.currentTime / this.videoPlayer.duration) * size;
    const rate = (position - low) / this.bufferSize;
    if (rate > 0.5) {
      console.log(position, this.videoPlayer.currentTime);
      await this.fillBuffer(high);
    }
  }

  onSeeking() {
    if (!this.mediaSource || !this.sourceBuffer) return;
    if (this.mediaSource.readyState === "open") {
      // this.sourceBuffer.abort();
      console.log(this.mediaSource.readyState);
    } else {
      console.log("seek but not open?");
      console.log(this.mediaSource.readyState);
      return;
    }
    const info = {
      command: "sync",
      param: this.videoPlayer.currentTime,
    };
    this.model.multicast(info);
  }

  private async fillBuffer(position: number) {
    this.chunkCounter++;
    if (this.mediaFile && this.sourceBuffer) {
      const length = Math.min(this.mediaFile.size - position, this.bufferSize);
      const blob = this.mediaFile.slice(position, position + length);
      this.totalSize += blob.size;
      const chunk = await blob.arrayBuffer();
      this.bufferRange = [position, position + chunk.byteLength];
      this.sourceBuffer.appendBuffer(chunk);
      this.model.streaming(chunk);
    }
  }
}
