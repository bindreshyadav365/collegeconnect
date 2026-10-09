(async function () {
  const { h } = CC;
  const $ = (id) => document.getElementById(id);
  const results = $('results');
  const stateEl = $('state');
  const moreBtn = $('more');

  let me;
  try { me = await CC.requireUser(); } catch { return; }
  CC.renderNav(me, 'dashboard');

  let page = 1;
  let reqId = 0;
  const cards = new Map(); // userId -> {statusEl, avatarDot}

  function setState(kind, title, text) {
    if (!kind) { stateEl.hidden = true; return; }
    stateEl.hidden = false;
    stateEl.replaceChildren(
      kind === 'loading' ? h('div', { class: 'spinner' }) : h('div', { class: 'emoji' }, kind === 'error' ? '⚠️' : '🔍'),
      title ? h('h3', {}, title) : null,
      text ? h('p', {}, text) : null,
      kind === 'error' ? h('button', { class: 'btn btn-small', type: 'button', onclick: () => load(true) }, 'Try again') : null
    );
  }

  function renderStatus(el, user) {
    el.className = `status${user.online ? ' on' : ''}`;
    el.replaceChildren(h('span', { class: 'pip' }), user.online ? 'Online' : 'Offline');
  }

  function card(u) {
    const statusEl = h('div', {});
    renderStatus(statusEl, u);
    const avatar = CC.avatar(u);
    cards.set(u.id, { statusEl, avatar });
    return h('article', { class: 'card student-card' },
      h('div', { class: 'student-top' },
        avatar,
        h('div', {},
          h('div', { class: 'student-name' }, u.name),
          h('div', { class: 'student-meta' }, `${u.branch} · ${CC.yearLabel(u.year)}`),
          h('div', { class: 'student-meta' }, u.college))),
      statusEl,
      u.bio ? h('div', { class: 'student-bio' }, u.bio) : null,
      h('button', { class: 'btn', type: 'button', onclick: (e) => { e.target.disabled = true; CC.startChat(u.id); } }, '💬 Message'));
  }

  async function load(reset) {
    if (reset) { page = 1; results.replaceChildren(); cards.clear(); }
    const my = ++reqId;
    moreBtn.hidden = true;
    if (page === 1) setState('loading', 'Searching…');
    const params = new URLSearchParams({ page });
    [['q', 'q'], ['college', 'college'], ['branch', 'branch'], ['year', 'year']].forEach(([id, key]) => {
      const v = $(id).value.trim();
      if (v) params.set(key, v);
    });
    try {
      const data = await CC.api('/users?' + params);
      if (my !== reqId) return; // a newer search superseded this one
      data.users.forEach((u) => results.append(card(u)));
      if (!results.children.length) setState('empty', 'No students found', 'Try different search terms.');
      else setState(null);
      moreBtn.hidden = !data.hasMore;
    } catch (err) {
      if (my !== reqId) return;
      setState('error', 'Could not load students', err.message);
    }
  }

  let timer;
  $('filters').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load(true), 300); });
  $('filters').addEventListener('submit', (e) => { e.preventDefault(); load(true); });
  moreBtn.addEventListener('click', () => { page += 1; load(false); });

  // Live presence + unread badge
  const socket = io({ withCredentials: true });
  socket.on('connect_error', (e) => { if (e.message === 'unauthorized') location.href = '/login'; });
  socket.on('presence', ({ userId, online, lastSeen }) => {
    const c = cards.get(userId);
    if (!c) return;
    renderStatus(c.statusEl, { online });
    const dot = c.avatar.querySelector('.dot');
    if (dot) dot.classList.toggle('on', online);
  });
  socket.on('message:new', (m) => { if (m.receiverId === me.id) refreshUnread(); });
  async function refreshUnread() {
    try {
      const { conversations } = await CC.api('/conversations');
      CC.setNavUnread(conversations.reduce((n, c) => n + c.unread, 0));
    } catch { /* ignore */ }
  }
  refreshUnread();

  load(true);
})();
