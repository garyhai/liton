import {html, css} from 'lit';
import {customElement, property, query} from 'lit/decorators.js';
import {putValue, RemoteModelBase} from './remoteview.js';

type ToDoItem = {
  text: string;
  completed: boolean;
};

@customElement('todo-list')
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
    console.log('onupdate: ', data, path);
    putValue(this.listItems, data, path);
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
              class=${item.completed ? 'completed' : ''}
              @click=${() => this.toggleCompleted(item, pos)}
            >
              ${item.text}
            </li>`
        )}
      </ul>
      <input id="newitem" aria-label="New item" @change=${this.addToDo} />
      <button @click=${this.addToDo}>Add</button>
      <button @click=${this.refresh}>Reset</button>
    `;
  }

  refresh() {
    this.model.getData();
  }

  toggleCompleted(item: ToDoItem, position: number) {
    item.completed = !item.completed;
    this.model.setData(item, `[${position}]`);
    this.requestUpdate();
  }

  @query('#newitem')
  input!: HTMLInputElement;

  addToDo() {
    this.listItems.push({text: this.input.value, completed: false});
    this.model.setData(this.listItems);
    this.requestUpdate();
    this.input.value = '';
  }
}
