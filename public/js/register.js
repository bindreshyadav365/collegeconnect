(function () {
  const form = document.getElementById('form');
  const formErr = document.getElementById('formError');
  const btn = document.getElementById('submit');
  const themeBtn = document.getElementById('themeBtn');
  themeBtn.addEventListener('click', () => { themeBtn.textContent = CC.toggleTheme() === 'dark' ? '☀️' : '🌙'; });

  const clearErrors = () => {
    formErr.textContent = '';
    form.querySelectorAll('[data-err]').forEach((el) => { el.textContent = ''; });
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    btn.disabled = true;
    btn.textContent = 'Creating account…';
    const body = {};
    ['name', 'email', 'password', 'college', 'branch', 'year', 'bio'].forEach((k) => { body[k] = form[k].value; });
    try {
      await CC.api('/auth/register', { method: 'POST', noRedirect: true, body });
      location.href = '/dashboard';
    } catch (ex) {
      formErr.textContent = ex.message;
      Object.entries(ex.details || {}).forEach(([field, msg]) => {
        const el = form.querySelector(`[data-err="${field}"]`);
        if (el) el.textContent = msg;
      });
      btn.disabled = false;
      btn.textContent = 'Create account';
    }
  });
})();
