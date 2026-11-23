(async () => {
  const response = await fetch('/api/auth/me', { cache: 'no-store' });
  if (response.status === 401) { location.replace('/login.html'); return; }
  if (!response.ok) return;
  const { user } = await response.json();
  const header = document.querySelector('.header-inner');
  if (!header) return;
  const group = document.createElement('div');
  group.className = 'account-controls';
  group.setAttribute('aria-label', 'Аккаунт и оформление');
  const avatar = document.createElement('span');
  avatar.className = 'account-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = user.username.slice(0, 1).toUpperCase();
  const label = document.createElement('span');
  label.className = 'account-name';
  label.textContent = user.username;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Выйти';
  button.className = 'button outline account-logout';
  group.append(avatar, label);
  const theme = document.getElementById('theme');
  if (theme) group.append(theme);
  group.append(button);
  header.append(group);
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const result = await fetch('/api/auth/logout', { method: 'POST' });
      if (!result.ok) throw Error('logout');
      location.replace('/login.html');
    } catch {
      button.textContent = 'Повторить выход';
      button.disabled = false;
    }
  });
})().catch(() => {});
window.addEventListener('pageshow', event => {
  if (event.persisted) location.reload();
});