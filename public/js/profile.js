(async function () {
  const { h } = CC;
  const $ = (id) => document.getElementById(id);

  let me;
  try { me = await CC.requireUser(); } catch { return; }
  CC.renderNav(me, 'profile');

  function paint() {
    $('avatarHolder').replaceChildren(CC.avatar({ ...me, online: false }, { size: 'lg', dot: false }));
    $('pName').textContent = me.name;
    $('pEmail').textContent = me.email;
    ['name', 'college', 'branch', 'bio'].forEach((k) => { $(k).value = me[k] || ''; });
    $('year').value = String(me.year);
  }
  paint();

  const form = $('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.querySelectorAll('[data-err]').forEach((el) => { el.textContent = ''; });
    const btn = $('save');
    btn.disabled = true;
    try {
      const body = {};
      ['name', 'college', 'branch', 'year', 'bio'].forEach((k) => { body[k] = $(k).value; });
      me = (await CC.api('/users/me', { method: 'PUT', body })).user;
      paint();
      CC.renderNav(me, 'profile');
      CC.toast('Profile saved', 'success');
    } catch (ex) {
      CC.toast(ex.message, 'error');
      Object.entries(ex.details || {}).forEach(([f, msg]) => {
        const el = form.querySelector(`[data-err="${f}"]`);
        if (el) el.textContent = msg;
      });
    } finally {
      btn.disabled = false;
    }
  });

  $('avatarFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return CC.toast('Image must be 2 MB or smaller', 'error');
    const fd = new FormData();
    fd.append('avatar', file);
    try {
      me = (await CC.api('/users/me/avatar', { method: 'POST', form: fd })).user;
      paint();
      CC.renderNav(me, 'profile');
      CC.toast('Photo updated', 'success');
    } catch (ex) {
      CC.toast(ex.message, 'error');
    }
  });

  async function loadBlocked() {
    const list = $('blocked');
    try {
      const { users } = await CC.api('/users/blocked');
      $('blockedState').textContent = users.length ? '' : 'You have not blocked anyone.';
      list.replaceChildren(...users.map((u) =>
        h('li', {},
          CC.avatar(u, { size: 'sm', dot: false }),
          h('div', { class: 'grow' }, h('div', { class: 'student-name' }, u.name), h('div', { class: 'student-meta' }, `${u.branch} · ${CC.yearLabel(u.year)}`)),
          h('button', {
            class: 'btn btn-ghost btn-small', type: 'button',
            onclick: async () => {
              try { await CC.api(`/users/${u.id}/block`, { method: 'DELETE' }); CC.toast('Unblocked', 'success'); loadBlocked(); }
              catch (ex) { CC.toast(ex.message, 'error'); }
            },
          }, 'Unblock'))));
    } catch (ex) {
      $('blockedState').textContent = ex.message;
    }
  }
  loadBlocked();
})();
