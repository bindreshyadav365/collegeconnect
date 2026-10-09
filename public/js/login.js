(function () {
  const form = document.getElementById('form');
  const err = document.getElementById('formError');
  const btn = document.getElementById('submit');
  const themeBtn = document.getElementById('themeBtn');
  themeBtn.addEventListener('click', () => { themeBtn.textContent = CC.toggleTheme() === 'dark' ? '☀️' : '🌙'; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Logging in…';
    try {
      await CC.api('/auth/login', {
        method: 'POST',
        noRedirect: true,
        body: { email: form.email.value, password: form.password.value },
      });
      location.href = '/dashboard';
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
      btn.textContent = 'Log in';
    }
  });
})();
