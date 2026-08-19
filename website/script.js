const root = document.documentElement;
const themeButton = document.querySelector('.theme-toggle');
const mobileMenu = document.querySelector('.mobile-menu');

themeButton?.addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try {
    localStorage.setItem('suvir-theme', next);
  } catch {
    // Browsing modes that block local storage can still use the choice for this visit.
  }
});

mobileMenu?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => mobileMenu.removeAttribute('open'));
});

// Screen gallery. Every panel is in the markup and visible without JavaScript;
// the tabs only take over once this script runs.
const gallery = document.querySelector('[data-gallery]');
if (gallery) {
  const tabs = [...gallery.querySelectorAll('[role="tab"]')];
  const panelFor = (tab) => document.getElementById(tab.getAttribute('aria-controls'));

  const select = (tab, { focus = false } = {}) => {
    tabs.forEach((candidate) => {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', String(selected));
      candidate.tabIndex = selected ? 0 : -1;
      panelFor(candidate)?.toggleAttribute('hidden', !selected);
    });
    if (focus) tab.focus();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      select(tabs[(index + step + tabs.length) % tabs.length], { focus: true });
    });
  });

  select(tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') ?? tabs[0]);
}
