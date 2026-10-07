export const $ = (id) => document.getElementById(id);

export function showError(message) {
  $('error-text').textContent = message;
  $('error-banner').hidden = false;
}

export function clearError() {
  $('error-banner').hidden = true;
}

export function flashNote(id, text = 'Saved') {
  const note = $(id);
  note.textContent = text;
  setTimeout(() => {
    note.textContent = '';
  }, 2000);
}

export async function reportError(fn) {
  try {
    await fn();
    clearError();
    return true;
  } catch (err) {
    showError(err.message);
    return false;
  }
}

export function withButton(button, fn) {
  return async (...args) => {
    button.disabled = true;
    await reportError(() => fn(...args));
    button.disabled = false;
  };
}
