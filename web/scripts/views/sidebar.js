const KEY = 'am.sidebar.collapsed';

function apply(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  for (const button of document.querySelectorAll('[data-sidebar-toggle]')) {
    button.setAttribute('aria-expanded', String(!collapsed));
  }
}

// Same breakpoint as the single-column layout in layout.css.
const NARROW = '(max-width: 1020px)';

export function mount() {
  // Until the user chooses, narrow screens open on the board rather than the forms.
  const stored = localStorage.getItem(KEY);
  apply(stored == null ? matchMedia(NARROW).matches : stored === '1');
  for (const button of document.querySelectorAll('[data-sidebar-toggle]')) {
    button.addEventListener('click', () => {
      const collapsed = !document.body.classList.contains('sidebar-collapsed');
      localStorage.setItem(KEY, collapsed ? '1' : '0');
      apply(collapsed);
    });
  }
}
