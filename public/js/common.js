(function () {
  const CC = (window.CC = {});

  /* ---------- Theme ---------- */
  const THEME_KEY = 'cc-theme';
  const readTheme = () => {
    try { return localStorage.getItem(THEME_KEY); } catch { return null; }
  };
  const applyTheme = (t) => { document.documentElement.dataset.theme = t; };
  applyTheme(readTheme() || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  CC.toggleTheme = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    return next;
  };

  /* ---------- DOM helper (always uses textContent: no HTML injection) ---------- */
  CC.h = function (tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  };
  const h = CC.h;

  /* ---------- API ---------- */
  CC.api = async function (path, opts = {}) {
    const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opts.form) init.body = opts.form;
    else if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    let res;
    try {
      res = await fetch('/api' + path, init);
    } catch {
      throw Object.assign(new Error('Network error. Check your connection.'), { status: 0 });
    }
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) {
      if (res.status === 401 && !opts.noRedirect) location.href = '/login';
      throw Object.assign(new Error((data && data.error) || 'Request failed'), {
        status: res.status,
        details: data && data.details,
      });
    }
    return data;
  };

  /* ---------- Toasts ---------- */
  CC.toast = function (message, type = 'info', ms = 4000) {
    let box = document.getElementById('toasts');
    if (!box) {
      box = h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' });
      document.body.append(box);
    }
    const t = h('div', { class: `toast ${type}`, role: 'status' }, message);
    box.append(t);
    setTimeout(() => t.remove(), ms);
  };

  /* ---------- Formatting ---------- */
  CC.formatTime = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  CC.dayKey = (d) => new Date(d).toDateString();
  CC.formatDay = (d) => {
    const date = new Date(d);
    const today = new Date();
    const y = new Date(); y.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === y.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  };
  CC.listTime = (d) => {
    const date = new Date(d);
    return date.toDateString() === new Date().toDateString()
      ? CC.formatTime(d)
      : date.toLocaleDateString([], { day: 'numeric', month: 'short' });
  };
  CC.presenceText = (u) => {
    if (u.online) return 'Online';
    if (!u.lastSeen) return 'Offline';
    const mins = Math.floor((Date.now() - new Date(u.lastSeen).getTime()) / 60000);
    if (mins < 1) return 'Last seen just now';
    if (mins < 60) return `Last seen ${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `Last seen ${hrs} h ago`;
    return `Last seen ${new Date(u.lastSeen).toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
  };
  CC.yearLabel = (y) => `Year ${y}`;

  /* ---------- Avatar ---------- */
  CC.avatar = function (user, { size = '', dot = true } = {}) {
    const hash = [...String(user.id || user.name)].reduce((a, c) => (a + c.charCodeAt(0)) % 8, 0);
    const initials = (user.name || '?').split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
    const el = h('span', { class: `avatar ${size} avatar-c${hash}`, 'data-user': user.id });
    if (user.profilePicture) {
      el.append(h('img', { src: user.profilePicture, alt: '', loading: 'lazy' }));
    } else {
      el.append(initials);
    }
    if (dot) el.append(h('span', { class: `dot${user.online ? ' on' : ''}` }));
    return el;
  };

  /* ---------- Session + navbar ---------- */
  CC.requireUser = async () => (await CC.api('/auth/me')).user;

  CC.logout = async () => {
    try { await CC.api('/auth/logout', { method: 'POST', noRedirect: true }); } catch { /* ignore */ }
    location.href = '/login';
  };

  CC.renderNav = function (user, active) {
    const nav = document.getElementById('nav');
    nav.className = 'nav';
    const link = (href, icon, label, key) =>
      h('a', { class: `link${active === key ? ' active' : ''}`, href }, icon, ' ', h('span', { class: 'label' }, label));
    const themeBtn = h('button', {
      class: 'icon-btn', type: 'button', title: 'Toggle dark mode', 'aria-label': 'Toggle dark mode',
      onclick: () => { themeBtn.textContent = CC.toggleTheme() === 'dark' ? '☀️' : '🌙'; },
    }, document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙');
    const badge = h('span', { class: 'nav-badge', id: 'navUnread', hidden: true });
    nav.replaceChildren(
      h('a', { class: 'brand', href: '/dashboard' }, 'College', h('span', {}, 'Connect')),
      h('nav', { class: 'nav-links' },
        link('/dashboard', '🔎', 'Find students', 'dashboard'),
        h('a', { class: `link${active === 'chat' ? ' active' : ''}`, href: '/chat' }, '💬 ', h('span', { class: 'label' }, 'Chats'), badge),
        link('/profile', '👤', 'Profile', 'profile')),
      h('div', { class: 'nav-right' },
        themeBtn,
        h('a', { href: '/profile', 'aria-label': 'My profile' }, CC.avatar(user, { size: 'sm', dot: false })),
        h('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: CC.logout }, 'Log out'))
    );
  };
  CC.setNavUnread = (n) => {
    const b = document.getElementById('navUnread');
    if (!b) return;
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n);
  };

  CC.startChat = async function (userId) {
    try {
      const { conversation } = await CC.api('/conversations', { method: 'POST', body: { userId } });
      location.href = `/chat/${conversation.id}`;
    } catch (err) {
      CC.toast(err.message, 'error');
    }
  };
})();
