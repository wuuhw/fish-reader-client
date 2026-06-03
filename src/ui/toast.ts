import { el } from './dom';

/** Brief bottom-center toast that auto-dismisses. */
export function showToast(message: string, ms = 2400): void {
  const t = el('div', 'app-toast', message);
  document.body.appendChild(t);
  // force reflow → trigger the show transition
  void t.offsetWidth;
  t.classList.add('show');
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 250);
  }, ms);
}
