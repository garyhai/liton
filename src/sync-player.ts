import {html} from "lit";
import {customElement, query, property} from "lit/decorators.js";
import {FileInfo, StripeFile} from "./model-controller.js";
import {putValue, RemoteModelBase} from "./remoteview.js";

export interface RemoteCommand {
  command: string;
  param?: number | FileInfo;
}

function isSameSource(
  s1: StripeFile | undefined,
  s2: StripeFile | undefined
): boolean {
  if (s1 == s2) return true;
  return !!s1 && !!s2 && s1.id == s2.id && s1.url == s2.url;
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
  fullScreen: boolean;
  source?: FileInfo;
  stripeFile?: StripeFile;
  duration?: number;
  width?: number;
  height?: number;
}

const MAX_GAP = 2;
@customElement("sync-player")
export class SyncPlayer extends RemoteModelBase {
  private mediaFile?: File;
  private received = 0;
  private canPlay = false;
  private toPlay = false;
  private isCaster = false;

  @property({type: Boolean})
  isHost = false;
  @property({type: Number})
  maxGap = MAX_GAP;
  @property({type: Number})
  bufferInterval = 50;

  @property({type: Object})
  vPlayer: VideoModel = {
    duration: 0,
    sync: true,
    syncInterval: 10,
    playing: false,
    syncing: 0,
    autoplay: false,
    controls: true,
    loop: false,
    muted: false,
    pip: false,
    fullScreen: false,
  };

  async onOpen() {
    if (this.isHost) {
      this.model.setData(this.vPlayer);
    } else {
      const player = (await this.model.getData()) as VideoModel;
      this.vPlayer = {...this.vPlayer, ...player};
      console.log("onOpen", this.vPlayer);
      if (this.vPlayer.playing) {
        this.remoteLoadVideo();
        this.playVideo();
      }
    }
  }

  onUpdate(data: unknown, path?: string) {
    console.log("onUpdate:", data);
    const {playing, syncing, fullScreen, stripeFile, muted, pip} = this.vPlayer;
    this.vPlayer = putValue(this.vPlayer, data, path);
    if (!isSameSource(this.vPlayer.stripeFile, stripeFile)) {
      if (this.vPlayer.stripeFile) {
        this.remoteLoadVideo();
      } else {
        this.closeVideo();
      }
    }
    if (this.vPlayer.playing !== playing) {
      if (playing) {
        this.videoPlayer.pause();
      } else {
        this.playVideo();
      }
    }
    if (this.vPlayer.muted !== muted) {
      console.log("change muted from ", muted);
      this.videoPlayer.muted = this.vPlayer.muted;
    }
    if (this.vPlayer.sync && this.vPlayer.syncing !== syncing) {
      this.syncSeek();
    }
    if (this.vPlayer.pip !== pip) {
      if (!pip) {
        this.videoPlayer
          .requestPictureInPicture()
          .catch((e) => console.error(e));
      }
    }
    if (this.vPlayer.fullScreen !== fullScreen) {
      if (fullScreen && document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        const controls = this.vPlayer.controls ? "show" : "hide";
        this.videoPlayer
          .requestFullscreen({navigationUI: controls})
          .catch((e) => console.error("failed to switch fullscreen mode: ", e));
      }
    }
    this.requestUpdate();
  }

  render() {
    if (this.isHost) {
      return html`
        <video
          id="videoPlayer"
          controls
          ?loop=${this.vPlayer.loop}
          ?autoplay=${this.vPlayer.autoplay}
          @timeupdate=${this.onTimeUpdate}
          @canplay=${this.onCanPlay}
          @seeking=${this.onSeeking}
          @play=${this.onHostPlay}
          @pause=${this.pauseVideo}
          @volumechange=${this.onVolumeChange}
          @enterpictureinpicture=${this.onPiP}
        ></video>
        <br />
        <label>
          <input
            type="file"
            id="videoFile"
            name="selectFile"
            @change=${this.localLoadVideo}
          />
        </label>
        <br />
        <label>
          <input
            type="checkbox"
            ?checked=${this.vPlayer.controls}
            @change=${this.setViewerControls}
          />允许远端控制
        </label>
      `;
    } else {
      return html`
        <video
          id="videoPlayer"
          preload="metadata"
          ?controls=${this.vPlayer.controls}
          ?loop=${this.vPlayer.loop}
          ?autoplay=${this.vPlayer.autoplay}
          @canplay=${this.onCanPlay}
          @loadeddata=${this.onLoadedData}
          @loadedmetadata=${this.onLoadedMetaata}
        ></video>
        <h3>已收到的数据长度：${this.received}</h3>
      `;
    }
  }

  @query("#videoFile")
  videoFile!: HTMLInputElement;

  @query("#videoPlayer")
  videoPlayer!: HTMLVideoElement;

  onLoadedData() {
    console.log("loaded first frame");
  }

  onLoadedMetaata() {
    console.log("metadata loaded", this.videoPlayer.duration);
  }

  closeVideo() {
    this.videoPlayer.src = "";
    this.mediaFile = undefined;
    this.canPlay = false;
    this.toPlay = false;
    this.isCaster = false;
    this.received = 0;
    this.stripes = [];
  }

  setViewerControls(ev: Event) {
    const controls = (ev.target as HTMLInputElement).checked;
    this.model.setData(controls, "controls");
  }

  syncSeek() {
    const gap = Math.abs(this.videoPlayer.currentTime - this.vPlayer.syncing);
    if (gap > this.maxGap) {
      console.log("sync the gap:", gap);
      this.videoPlayer.currentTime = this.vPlayer.syncing;
    }
  }

  async onHostPlay() {
    this.vPlayer.playing = true;
    this.model.setData(true, "playing");
  }

  onPiP() {
    this.vPlayer.pip = true;
    this.model.setData(true, "pip");
  }

  onCanPlay() {
    console.log("video is can play now");
    this.canPlay = true;
    if (this.isCaster) {
      this.vPlayer.duration = this.videoPlayer.duration;
      if (this.bufferInterval >= this.vPlayer.duration) {
        this.chunkSize = this.vPlayer.source!.size;
        this.chunkTime = this.vPlayer.duration;
      } else {
        let bs =
        (this.bufferInterval / this.vPlayer.duration) *
        this.vPlayer.source!.size;
        bs = Math.ceil(bs);
        this.chunkSize = Math.max(bs, this.minChunkSize);
        this.chunkTime = this.chunkSize / this.vPlayer.source!.size * this.vPlayer.duration;
      }
      console.log("chunk size =", this.chunkSize, ", interval = ", this.chunkTime);
      this.bufferFile();
    } else if (this.toPlay) {
      this.playVideo();
    }
  }

  private async bufferFile() {
    if (!this.mediaFile || !this.vPlayer.stripeFile) return;
    let stripes = new Array;
    let current = 0;
    let data = this.model.buffering(this.mediaFile, this.vPlayer.stripeFile.id, 0);
    let rest = 0;
    let buffered = 0;
    while (data != undefined && this.mediaFile) {
      rest = data.size;
      let position = this.videoPlayer.currentTime / this.videoPlayer.duration * this.mediaFile.size;
      position = Math.floor(position);
      buffered = this.mediaFile.size - rest;
      if (position < )
    }


    // position ??= this.videoPlayer.currentTime;
    // if (isNaN(position) || this.chunkTime == 0) return;
    // const float = position / this.chunkTime;
    // const current = Math.floor(float);
    // this.doBuffer(current);
    // const next = Math.round(float);
    // if (current != next) {
    //   this.doBuffer(next);
    // }
  }

  private doBuffer(chunk: number) {
    if (!this.mediaFile || !this.vPlayer.stripeFile) {
      console.error("media source is not ready for buffering");
      return;
    }
    if (!this.stripes.has(chunk)) {
      const cursor = chunk * this.chunkSize;
      console.log("Buffering chunk", chunk, "at position", cursor);
      if (cursor < this.mediaFile.size) {
        const blob = this.mediaFile.slice(cursor, cursor + this.chunkSize);
        this.model.buffering(blob, this.vPlayer.stripeFile.id, cursor);
        this.stripes.add(chunk);
        console.log("stripes: ", this.stripes, "last chunk:", blob.size);
      } else {
        console.error("Out of bound of file:", this.mediaFile.size, cursor);
      }
    }
  }

  onVolumeChange() {
    console.log("volume changed", this.videoPlayer.volume);
    if (this.isHost) {
      if (this.videoPlayer.muted !== this.vPlayer.muted) {
        this.vPlayer.muted = this.videoPlayer.muted;
        this.model.setData(this.vPlayer.muted, "muted");
      }
    }
  }

  playVideo() {
    // if (!this.canPlay) {
    //   console.log("video is not ready for playing");
    //   this.toPlay = true;
    //   return;
    // }
    this.videoPlayer
      .play()
      .then(() => (this.toPlay = false))
      .catch((e) => console.error("failed to play video:", e));
  }

  pauseVideo() {
    this.videoPlayer.pause();
    if (this.isHost) {
      this.vPlayer.playing = false;
      this.model.setData(false, "playing");
    }
  }

  async localLoadVideo() {
    this.closeVideo();
    if (!this.videoPlayer || !this.videoFile || this.videoFile.value == "")
      return;
    this.isCaster = true;
    this.mediaFile = this.videoFile.files![0];
    const {name, size, type: mimeType, lastModified} = this.mediaFile;
    const fileSource = {name, size, mimeType, lastModified};
    this.vPlayer.source = fileSource;
    this.vPlayer.stripeFile = await this.model.createFileBuffer(fileSource);
    this.videoPlayer.src = URL.createObjectURL(this.mediaFile);
    this.model.setData(this.vPlayer);
    this.requestUpdate();
  }

  remoteLoadVideo() {
    this.closeVideo();
    const url = this.vPlayer.stripeFile?.url;
    if (url == null) return;
    console.log("video to play:", url);
    this.videoPlayer.src = url;
    this.videoPlayer.load();
  }

  onSeeking() {
    if (!this.canPlay) return;
    this.vPlayer.syncing = this.videoPlayer.currentTime;
    this.model.setData(this.vPlayer.syncing, "syncing");
  }

  onTimeUpdate() {
    if (this.isCaster) this.bufferFile();
  }
}
