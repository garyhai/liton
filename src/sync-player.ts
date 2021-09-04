import {html} from "lit";
import {customElement, query, property} from "lit/decorators.js";
import {FileInfo, JsonRpcError, StripeFile} from "./model-controller.js";
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
  bufferTime: number;
  fullScreen: boolean;
  source?: FileInfo;
  stripeFile?: StripeFile;
  duration?: number;
  width?: number;
  height?: number;
}

const MIN_BUFFER_SIZE = 2_000_000;
const MAX_GAP = 3;
@customElement("sync-player")
export class SyncPlayer extends RemoteModelBase {
  // private mediaSource?: MediaSource;
  private mediaFile?: File;
  // private sourceBuffer?: SourceBuffer;
  // private buffers: ArrayBuffer[] = [];
  // private bufferRange = [0, 0];
  private bufferSize = MIN_BUFFER_SIZE;
  private received = 0;
  private canPlay = false;
  private toPlay = false;
  private isCaster = false;

  @property({type: Boolean})
  isHost = false;
  @property({type: Number})
  maxGap = MAX_GAP;

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
    bufferTime: 20,
  };

  async onOpen() {
    if (this.isHost) {
      this.model.setData(this.vPlayer);
    } else {
      const player = (await this.model.getData()) as VideoModel;
      this.vPlayer = {...this.vPlayer, ...player};
      console.log("onOpen", this.vPlayer);
      // this.remoteLoadVideo();
    }
    // try {
    //   const player = (await this.model.getData()) as VideoModel;
    //   this.vPlayer = {...this.vPlayer, ...player};
    //   console.log("onOpen", this.vPlayer);
    //   this.remoteLoadVideo();
    // } catch (e) {
    //   if (e instanceof JsonRpcError && this.isHost) {
    //     this.model.setData(this.vPlayer);
    //   } else {
    //     throw e;
    //   }
    // }
  }

  onUpdate(data: unknown, path?: string) {
    const {playing, syncing, fullScreen, stripeFile, muted} = this.vPlayer;
    putValue(this.vPlayer, data, path);
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
          @canplay=${this.onCanPlay}
          @seeking=${this.onSeeking}
          @play=${this.onHostPlay}
          @pause=${this.pauseVideo}
          @volumechange=${this.onVolumeChange}
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
          ?controls=${this.vPlayer.controls}
          ?loop=${this.vPlayer.loop}
          ?autoplay=${this.vPlayer.autoplay}
          @canplay=${this.onCanPlay}
        ></video>
        <h3>已收到的数据长度：${this.received}</h3>
      `;
    }
  }

  @query("#videoFile")
  videoFile!: HTMLInputElement;

  @query("#videoPlayer")
  videoPlayer!: HTMLVideoElement;

  closeVideo() {
    // try {
    //   this.sourceBuffer?.abort();
    //   this.mediaSource?.endOfStream();
    // } catch (e) {
    //   console.error("exception when video closing:", e);
    // }
    this.videoPlayer.srcObject = null;
    this.videoPlayer.src = "";
    // this.mediaSource = undefined;
    // this.sourceBuffer = undefined;
    this.mediaFile = undefined;
    // this.bufferRange = [0, 0];
    this.canPlay = false;
    this.toPlay = false;
    this.isCaster = false;
    // this.buffers = [];
    this.received = 0;
  }

  setViewerControls(ev: Event) {
    const controls = (ev.target as HTMLInputElement).checked;
    this.model.setData(controls, "controls");
  }

  syncSeek() {
    const {syncing} = this.vPlayer;
    const gap = Math.abs(this.videoPlayer.currentTime - syncing);
    if (gap > this.maxGap) {
      console.log("sync the gap:", gap);
      this.videoPlayer.currentTime = syncing;
    }
  }

  async onHostPlay() {
    this.vPlayer.playing = true;
    this.model.setData(true, "playing");
    // await this.videoPlayer.play();
  }

  onCanPlay() {
    console.log("video is can play now");
    this.canPlay = true;
    if (this.isCaster) {
      this.vPlayer.duration = this.videoPlayer.duration;
      const bs =
        (this.vPlayer.bufferTime / this.vPlayer.duration) *
        this.vPlayer.source!.size;
      this.bufferSize = Math.max(bs, MIN_BUFFER_SIZE);
      console.log("buffer size:", this.bufferSize);
    } else if (this.toPlay) {
      this.playVideo();
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
    if (!this.canPlay) {
      console.log("video is not ready for playing");
      this.toPlay = true;
      return;
    }
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
    this.model.buffering(this.mediaFile, this.vPlayer.stripeFile.id, 0);
    this.canPlay = false;
    this.videoPlayer.src = URL.createObjectURL(this.mediaFile);
    this.model.setData(this.vPlayer);
    this.requestUpdate();
  }

  remoteLoadVideo() {
    this.closeVideo();
    const url = this.vPlayer.stripeFile?.url;
    console.log("video to play:", url);
    if (url == null) return;
    this.videoPlayer.src = URL.createObjectURL(url);
    this.canPlay = false;
  }

  onSeeking() {
    if (!this.canPlay) return;
    this.vPlayer.syncing = this.videoPlayer.currentTime;
    this.model.setData(this.vPlayer.syncing, "syncing");
  }
}
