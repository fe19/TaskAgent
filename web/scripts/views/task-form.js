import { $, withButton, showError } from '../ui.js';
import { post, put } from '../api-client.js';
import { state } from '../store.js';

// Set while the dialog edits a queued task instead of creating one.
let editingId = null;

function show({ title, submit, prompt = '', priority = '0' }) {
  const form = $('task-form');
  $('task-dialog-title').textContent = title;
  $('task-submit').textContent = submit;
  form.elements.prompt.value = prompt;
  form.elements.priority.value = priority;
  $('task-dialog').showModal();
  form.elements.prompt.focus();
}

function open() {
  editingId = null;
  show({ title: 'New task', submit: 'Add to queue' });
}

/** Opens the form on a queued task; tasks that have started cannot change. */
export function edit(id) {
  const task = state.tasks.find((t) => String(t.id) === String(id));
  if (!task || task.status !== 'queued') {
    showError('Only a queued task can be edited.');
    return;
  }
  editingId = task.id;
  show({ title: 'Edit task', submit: 'Save changes', prompt: task.prompt, priority: String(task.priority) });
}

export function mount({ refresh }) {
  const form = $('task-form');
  const dialog = $('task-dialog');
  $('task-new').addEventListener('click', open);
  // Ctrl, not Cmd: Cmd+N stays the browser's new window on macOS.
  document.addEventListener('keydown', (event) => {
    if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'n') return;
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault();
    open();
  });
  $('task-dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    editingId = null;
    form.reset();
  });
  form.addEventListener(
    'submit',
    withButton($('task-submit'), async (event) => {
      event.preventDefault();
      const body = {
        prompt: form.elements.prompt.value,
        priority: Number(form.elements.priority.value),
      };
      if (editingId == null) await post('/api/tasks', body);
      else await put(`/api/tasks/${editingId}`, body);
      dialog.close();
      await refresh();
    }),
  );
}
