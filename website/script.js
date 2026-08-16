const themeButton = document.querySelector('.theme-toggle');
const mobileMenu = document.querySelector('.mobile-menu');

themeButton?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('suvir-theme', next);
  } catch {
    // Browsing modes that block local storage can still use the selected theme for this visit.
  }
});

mobileMenu?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => mobileMenu.removeAttribute('open'));
});
