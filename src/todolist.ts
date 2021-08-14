import {LitElement, html, css} from 'lit';
import {customElement, property, query} from 'lit/decorators.js';
import {ModelController, RemoteModelHost} from './model-controller.js';

type ToDoItem = {
  text: string,
  completed: boolean
}

@customElement('todo-list')
export class ToDoList extends LitElement implements RemoteModelHost {
  // Create the controller and store it
  private model = new ModelController(this, "ws://127.0.0.1:8080/ws/model/todolist");

  static get styles() {
    return css`
      .completed {
        text-decoration-line: line-through;
        color: #777;
      }
    `;
  }

  onUpdate(data: any, path?: string) {
    console.log("onupdate: ", data, path);
    if (path === "." || path === undefined) {
      this.listItems = data;
      this.requestUpdate();
    } else {
      this.refresh();
    }
  }

  @property({attribute: false})
  listItems: ToDoItem[] = [
  ];
  @property()
  hideCompleted = false;

  render() {
    return html`
      <h2>To Do</h2>
      <ul>
        ${this.listItems.map((item, pos) =>
          html`
            <li
                class=${item.completed ? 'completed' : ''}
                @click=${() => this.toggleCompleted(item, pos)}>
              ${item.text}
            </li>`
        )}
      </ul>
      <input id="newitem" aria-label="New item">
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
