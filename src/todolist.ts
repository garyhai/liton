import {html, css} from "lit";
import {customElement, property, query} from "lit/decorators.js";
import {JsonRpcError} from "./model-controller.js";
import {putValue, RemoteModelBase} from "./remoteview.js";

type ToDoItem = {
  text: string;
  completed: boolean;
};

@customElement("todo-list")
export class ToDoList extends RemoteModelBase {
  static get styles() {
    return css`
      .completed {
        text-decoration-line: line-through;
        color: #777;
      }
    `;
  }

  onUpdate(data: unknown, path?: string) {
    console.log("onupdate: ", data, path, this.listItems);
    this.listItems = putValue(this.listItems, data, path);
    console.log("updated:", this.listItems);
    this.requestUpdate();
  }

  @property({attribute: false})
  listItems: ToDoItem[] = [];
  @property({type: Boolean})
  hideCompleted = false;

  render() {
    return html`
      <h2>数据存放在远程的 To Do</h2>
      <ul>
        ${this.listItems.map(
          (item, pos) =>
            html` <li
              class=${item.completed ? "completed" : ""}
              @click=${() => this.toggleCompleted(item, pos)}
            >
              ${item.text}
            </li>`
        )}
      </ul>
      <input id="newitem" aria-label="New item" @change=${this.addToDo} />
      <button @click=${this.addToDo}>Add</button>
      <button @click=${this.refresh}>Refresh</button>
      <button @click=${this.reset}>Reset</button>
      <br />
        <label>
          <input
            type="file"
            id="instantFile"
            name="selectFile"
            @change=${this.bufferTest}
          />
        </label>
      <br/>
      <video controls id="videoPlayer" >
      </video>
    `;
  }
  @query("#instantFile")
  instantFile!: HTMLInputElement;

  @query("#videoPlayer")
  videoPlayer!: HTMLVideoElement;

  async bufferTest() {
    const file = this.instantFile.files![0];
    const {name, type: mimeType, size, lastModified} = file;
    const info = {name, mimeType, size, lastModified};
    const handle = await this.model.createFileBuffer(info);
    console.log(handle.url);
    this.model.buffering(file, handle.id, 0);
    this.videoPlayer.src = handle.url;
    // this.videoSource.type = file.type;
    // this.requestUpdate();
  }

  async onOpen() {
    try {
      await this.refresh();
    } catch (e) {
      if (e instanceof JsonRpcError) {
        this.model.setData(this.listItems);
      } else {
        throw e;
      }
    }
  }

  async refresh() {
    this.listItems = (await this.model.getData()) as ToDoItem[];
    this.requestUpdate();
  }

  async reset() {
    this.listItems = [];
    this.model.setData([]);
    this.requestUpdate();
  }

  toggleCompleted(item: ToDoItem, position: number) {
    item.completed = !item.completed;
    this.model.setData(item, `[${position}]`);
    this.requestUpdate();
  }

  @query("#newitem")
  input!: HTMLInputElement;

  addToDo() {
    this.listItems.push({text: this.input.value, completed: false});
    this.model.setData(this.listItems);
    this.requestUpdate();
    this.input.value = "";
  }
}
