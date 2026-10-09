(async function () {
  const { h } = CC;
  const $ = (id) => document.getElementById(id);

  let me;
  try { me = await CC.requireUser(); } catch { return; }
  CC.renderNav(me, 'chat');

  const layout = $('layout');
  const listEl = $('convList');
  const messagesEl = $('messages');
  const input = $('input');

  const convs = new Map(); // id -> conversation summary
  let activeId = null;
  let messages = []; // messages of the active conversation (ascending)
  let hasMore = false;
  let loadToken = 0; // guards against out-of-order responses when switching chats
  let typingTimer = null;
  let lastTypingSent = 0;
  let filter = '';

  const emptyDefault = [...$('threadEmpty').childNodes].map((n) => n.cloneNode(true));
  const showEmpty = () => {
    $('threadEmpty').replaceChildren(...emptyDefault.map((n) => n.cloneNode(true)));
    $('threadEmpty').hidden = false;
    $('threadMain').hidden = true;
  };

  const idFromPath = () => {
    const m = location.pathname.match(/^\/chat\/([^/]+)/);
    return m ? m[1] : null;
  };

  /* ================= Sidebar ================= */
  const sortedConvs = () =>
    [...convs.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  function totalUnread() {
    return [...convs.values()].reduce((n, c) => n + c.unread, 0);
  }

  function renderList() {
    const q = filter.trim().toLowerCase();
    const items = sortedConvs().filter((c) => !q || c.user.name.toLowerCase().includes(q));
    CC.setNavUnread(totalUnread());
    if (!items.length) {
      listEl.replaceChildren(h('li', { class: 'state' },
        convs.size ? 'No chats match your search.' : h('span', {}, 'No chats yet. ', h('a', { href: '/dashboard' }, 'Find a student'), ' to say hello.')));
      return;
    }
    listEl.replaceChildren(...items.map((c) => {
      const last = c.lastMessage;
      const preview = last ? `${last.senderId === me.id ? 'You: ' : ''}${last.content}` : 'No messages yet';
      return h('li', {
        class: `conv-item${c.id === activeId ? ' active' : ''}${c.unread ? ' unread' : ''}`,
        tabindex: '0', role: 'button', 'data-id': c.id,
        onclick: () => openConversation(c.id, true),
        onkeydown: (e) => { if (e.key === 'Enter') openConversation(c.id, true); },
      },
        CC.avatar(c.user),
        h('div', { class: 'conv-body' },
          h('div', { class: 'conv-row' },
            h('span', { class: 'conv-name' }, c.user.name),
            h('span', { class: 'conv-time' }, last ? CC.listTime(last.createdAt) : '')),
          h('div', { class: 'conv-row' },
            h('span', { class: 'conv-last' }, preview),
            c.unread ? h('span', { class: 'badge' }, c.unread > 99 ? '99+' : c.unread) : null)));
    }));
  }

  async function loadConversations() {
    try {
      const { conversations } = await CC.api('/conversations');
      convs.clear();
      conversations.forEach((c) => convs.set(c.id, c));
      renderList();
    } catch (err) {
      listEl.replaceChildren(h('li', { class: 'state' }, 'Could not load chats. ',
        h('button', { class: 'btn btn-small', type: 'button', onclick: loadConversations }, 'Retry')));
    }
  }

  $('convSearch').addEventListener('input', (e) => { filter = e.target.value; renderList(); });

  /* ================= Thread header ================= */
  function renderHeader() {
    const c = convs.get(activeId);
    if (!c) return;
    $('headAvatar').replaceChildren(CC.avatar(c.user));
    $('headName').textContent = c.user.name;
    const st = $('headStatus');
    if (typingTimer) {
      st.className = 'status typing';
      st.textContent = 'typing…';
    } else {
      st.className = `status${c.user.online ? ' on' : ''}`;
      st.replaceChildren(h('span', { class: 'pip' }), CC.presenceText(c.user));
    }
    $('blockBtn').textContent = c.blockedByMe ? 'Unblock' : 'Block';
    const note = $('composerNote');
    $('composer').hidden = !c.canMessage;
    note.hidden = c.canMessage;
    note.textContent = c.blockedByMe
      ? 'You blocked this student. Unblock them to send messages.'
      : 'You can no longer message this student.';
  }

  /* ================= Messages ================= */
  const nearBottom = () => messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
  const scrollBottom = () => { messagesEl.scrollTop = messagesEl.scrollHeight; };

  function messageNode(m) {
    const mine = m.senderId === me.id;
    const meta = h('div', { class: 'meta' },
      m.edited ? h('span', {}, 'edited') : null,
      h('span', {}, CC.formatTime(m.createdAt)),
      mine ? h('span', { class: `tick${m.read ? ' read' : ''}`, title: m.read ? 'Read' : 'Sent' }, m.read ? '✓✓' : '✓') : null);
    const bubble = h('div', { class: 'bubble' }, m.content, meta);
    const row = h('div', { class: `msg ${mine ? 'sent' : 'received'}`, 'data-id': m.id }, bubble);
    if (mine) {
      bubble.append(h('div', { class: 'msg-actions' },
        h('button', { type: 'button', onclick: () => editMessage(m) }, 'Edit'),
        h('button', { type: 'button', onclick: () => deleteMessage(m) }, 'Delete')));
      bubble.addEventListener('click', () => row.classList.toggle('show-actions'));
    }
    return row;
  }

  function renderMessages({ keepScroll = false, forceBottom = false } = {}) {
    const stick = forceBottom || nearBottom();
    const prevHeight = messagesEl.scrollHeight;
    const prevTop = messagesEl.scrollTop;
    const nodes = [];
    if (hasMore) {
      nodes.push(h('button', { class: 'btn btn-ghost btn-small load-more', type: 'button', onclick: loadOlder }, 'Load earlier messages'));
    }
    if (!messages.length) {
      nodes.push(h('div', { class: 'state' }, h('div', { class: 'emoji' }, '👋'),
        h('h3', {}, 'No messages yet'), h('p', {}, 'Say hello and start the conversation.')));
    }
    let day = null;
    messages.forEach((m) => {
      const k = CC.dayKey(m.createdAt);
      if (k !== day) { day = k; nodes.push(h('div', { class: 'day-sep' }, CC.formatDay(m.createdAt))); }
      nodes.push(messageNode(m));
    });
    messagesEl.replaceChildren(...nodes);
    if (keepScroll) messagesEl.scrollTop = prevTop + (messagesEl.scrollHeight - prevHeight);
    else if (stick) scrollBottom();
  }

  function showThreadState(kind, title, text, retry) {
    messagesEl.replaceChildren(h('div', { class: 'state' },
      kind === 'loading' ? h('div', { class: 'spinner' }) : h('div', { class: 'emoji' }, '⚠️'),
      h('h3', {}, title), text ? h('p', {}, text) : null,
      retry ? h('button', { class: 'btn btn-small', type: 'button', onclick: retry }, 'Try again') : null));
  }

  function showNoAccess(status) {
    activeId = null;
    $('threadMain').hidden = true;
    $('threadEmpty').hidden = false;
    $('threadEmpty').replaceChildren(
      h('div', { class: 'emoji' }, '🔒'),
      h('h3', {}, status === 403 ? 'You do not have access to this conversation' : status === 404 ? 'Conversation not found' : 'Could not open conversation'),
      h('p', {}, 'Pick one of your chats on the left.'));
    layout.classList.add('has-active');
    renderList();
  }

  async function openConversation(id, push) {
    const token = ++loadToken;
    activeId = id;
    messages = [];
    hasMore = false;
    if (push) history.pushState({}, '', `/chat/${id}`);
    layout.classList.add('has-active');
    $('threadEmpty').hidden = true;
    $('threadMain').hidden = false;
    clearTyping();
    renderList();

    // Fetch the (authorization-checked) summary even if the list doesn't have it yet.
    try {
      if (!convs.has(id)) {
        showThreadState('loading', 'Loading…');
        const { conversation } = await CC.api(`/conversations/${id}`);
        if (token !== loadToken) return;
        convs.set(conversation.id, conversation);
      }
    } catch (err) {
      if (token !== loadToken) return;
      return showNoAccess(err.status);
    }
    renderHeader();
    renderList();
    await loadMessages(token);
  }

  async function loadMessages(token = loadToken) {
    showThreadState('loading', 'Loading messages…');
    try {
      const data = await CC.api(`/messages/${activeId}?limit=50`);
      if (token !== loadToken) return;
      messages = data.messages;
      hasMore = data.hasMore;
      renderMessages({ forceBottom: true });
      input.focus({ preventScroll: true });
      markRead();
    } catch (err) {
      if (token !== loadToken) return;
      if (err.status === 403 || err.status === 404) return showNoAccess(err.status);
      showThreadState('error', 'Could not load messages', err.message, () => loadMessages(token));
    }
  }

  async function loadOlder() {
    if (!messages.length) return;
    const token = loadToken;
    try {
      const data = await CC.api(`/messages/${activeId}?limit=50&before=${encodeURIComponent(messages[0].createdAt)}`);
      if (token !== loadToken) return;
      const have = new Set(messages.map((m) => m.id));
      messages = [...data.messages.filter((m) => !have.has(m.id)), ...messages];
      hasMore = data.hasMore;
      renderMessages({ keepScroll: true });
    } catch (err) {
      CC.toast(err.message, 'error');
    }
  }

  // After a reconnect, fetch anything we missed while offline.
  async function syncMissed() {
    await loadConversations();
    if (!activeId || !convs.has(activeId)) return;
    try {
      const latest = messages.length ? messages[messages.length - 1].createdAt : null;
      const q = latest ? `&after=${encodeURIComponent(latest)}` : '';
      const data = await CC.api(`/messages/${activeId}?limit=100${q}`);
      const have = new Set(messages.map((m) => m.id));
      const fresh = data.messages.filter((m) => !have.has(m.id));
      if (fresh.length) { messages = [...messages, ...fresh]; renderMessages(); markRead(); }
      renderHeader();
    } catch { /* ignore, user can reload */ }
  }

  function markRead() {
    const c = convs.get(activeId);
    if (!c || document.hidden) return;
    if (!c.unread && !messages.some((m) => m.receiverId === me.id && !m.read)) return;
    c.unread = 0;
    messages.forEach((m) => { if (m.receiverId === me.id) m.read = true; });
    renderList();
    if (socket.connected) socket.emit('messages:read', { conversationId: activeId });
    else CC.api(`/messages/${activeId}/read`, { method: 'POST' }).catch(() => {});
  }

  /* ================= Sending / editing ================= */
  let sending = false;
  async function send() {
    const c = convs.get(activeId);
    const text = input.value.trim();
    if (!c || !text || sending) return;
    if (!c.canMessage) return CC.toast('You cannot message this student', 'error');
    sending = true;
    $('sendBtn').disabled = true;
    const previous = input.value;
    input.value = '';
    autosize();
    try {
      let message;
      if (socket.connected) {
        const res = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ ok: false, error: 'Timed out. Please try again.' }), 8000);
          socket.emit('message:send', { conversationId: activeId, content: text }, (r) => { clearTimeout(timer); resolve(r); });
        });
        if (!res.ok) throw new Error(res.error || 'Could not send');
        message = res.message;
      } else {
        message = (await CC.api(`/messages/${activeId}`, { method: 'POST', body: { content: text } })).message;
      }
      addIncoming(message); // idempotent: also arrives via 'message:new'
      stopTyping();
    } catch (err) {
      input.value = previous; // don't lose the user's text
      autosize();
      CC.toast(err.message, 'error');
      if (/blocked|cannot message/i.test(err.message)) loadConversations().then(renderHeader);
    } finally {
      sending = false;
      $('sendBtn').disabled = false;
      input.focus();
    }
  }

  async function editMessage(m) {
    const next = window.prompt('Edit message', m.content);
    if (next === null || next.trim() === m.content) return;
    try {
      const { message } = await CC.api(`/messages/item/${m.id}`, { method: 'PATCH', body: { content: next } });
      applyUpdate(message);
    } catch (err) { CC.toast(err.message, 'error'); }
  }

  async function deleteMessage(m) {
    if (!window.confirm('Delete this message for both of you?')) return;
    try {
      await CC.api(`/messages/item/${m.id}`, { method: 'DELETE' });
      applyDelete({ id: m.id, conversationId: m.conversationId });
    } catch (err) { CC.toast(err.message, 'error'); }
  }

  function applyUpdate(message) {
    if (message.conversationId !== activeId) return loadConversations();
    const i = messages.findIndex((x) => x.id === message.id);
    if (i >= 0) { messages[i] = message; renderMessages(); }
    loadConversations();
  }
  function applyDelete({ id, conversationId }) {
    if (conversationId === activeId) { messages = messages.filter((m) => m.id !== id); renderMessages(); }
    loadConversations();
  }

  // Add a message (from socket/REST) to state, once.
  function addIncoming(m) {
    let c = convs.get(m.conversationId);
    if (!c) { loadConversations(); }
    else {
      c.lastMessage = { content: m.content.slice(0, 120), senderId: m.senderId, createdAt: m.createdAt };
      c.updatedAt = m.createdAt;
    }
    if (m.conversationId === activeId) {
      if (!messages.some((x) => x.id === m.id)) {
        messages.push(m);
        renderMessages({ forceBottom: m.senderId === me.id });
      }
      if (m.receiverId === me.id) {
        if (!document.hidden) { m.read = true; markReadSoon(); }
        else if (c) c.unread += 1;
      }
    } else if (m.receiverId === me.id && c) {
      c.unread += 1;
    }
    renderList();
  }
  let readTimer;
  const markReadSoon = () => {
    clearTimeout(readTimer);
    readTimer = setTimeout(() => {
      if (socket.connected) socket.emit('messages:read', { conversationId: activeId });
    }, 150);
  };

  /* ================= Typing ================= */
  function clearTyping() {
    clearTimeout(typingTimer);
    typingTimer = null;
    if (activeId && convs.has(activeId)) renderHeader();
  }
  let iAmTyping = false;
  function stopTyping() {
    if (iAmTyping && socket.connected) socket.emit('typing', { conversationId: activeId, typing: false });
    iAmTyping = false;
  }
  input.addEventListener('input', () => {
    autosize();
    if (!socket.connected || !activeId) return;
    const now = Date.now();
    if (now - lastTypingSent > 2000) {
      lastTypingSent = now;
      iAmTyping = true;
      socket.emit('typing', { conversationId: activeId, typing: true });
    }
  });

  /* ================= Composer ================= */
  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }
  $('composer').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });

  /* ================= Block / unblock ================= */
  $('blockBtn').addEventListener('click', async () => {
    const c = convs.get(activeId);
    if (!c) return;
    try {
      if (c.blockedByMe) {
        await CC.api(`/users/${c.user.id}/block`, { method: 'DELETE' });
        CC.toast(`${c.user.name} unblocked`, 'success');
      } else {
        if (!window.confirm(`Block ${c.user.name}? Neither of you will be able to send messages.`)) return;
        await CC.api(`/users/${c.user.id}/block`, { method: 'POST' });
        CC.toast(`${c.user.name} blocked`, 'success');
      }
      await loadConversations();
      renderHeader();
    } catch (err) { CC.toast(err.message, 'error'); }
  });

  /* ================= Navigation ================= */
  $('backBtn').addEventListener('click', () => {
    history.pushState({}, '', '/chat');
    activeId = null;
    ++loadToken;
    layout.classList.remove('has-active');
    showEmpty();
    renderList();
  });
  window.addEventListener('popstate', () => {
    const id = idFromPath();
    if (id) openConversation(id, false);
    else {
      activeId = null; ++loadToken;
      layout.classList.remove('has-active');
      showEmpty();
      renderList();
    }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) markRead(); });

  /* ================= Socket ================= */
  const socket = io({ withCredentials: true, reconnectionDelayMax: 5000 });
  let everConnected = false;

  socket.on('connect', () => {
    $('connBanner').hidden = true;
    if (everConnected) syncMissed(); // reconnect: catch up on anything missed
    everConnected = true;
  });
  socket.on('disconnect', () => {
    $('connBanner').textContent = 'Connection lost. Reconnecting…';
    $('connBanner').hidden = false;
  });
  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') { location.href = '/login'; return; }
    $('connBanner').hidden = false;
  });

  socket.on('message:new', addIncoming);
  socket.on('message:updated', applyUpdate);
  socket.on('message:deleted', applyDelete);
  socket.on('messages:read', ({ conversationId }) => {
    if (conversationId !== activeId) return;
    let changed = false;
    messages.forEach((m) => { if (m.senderId === me.id && !m.read) { m.read = true; changed = true; } });
    if (changed) renderMessages();
  });
  socket.on('presence', ({ userId, online, lastSeen }) => {
    convs.forEach((c) => {
      if (c.user.id !== userId) return;
      c.user.online = online;
      if (lastSeen) c.user.lastSeen = lastSeen;
    });
    renderList();
    if (activeId && convs.get(activeId) && convs.get(activeId).user.id === userId) renderHeader();
  });
  socket.on('typing', ({ conversationId, typing }) => {
    if (conversationId !== activeId) return;
    clearTimeout(typingTimer);
    typingTimer = null;
    if (typing) typingTimer = setTimeout(clearTyping, 3500);
    renderHeader();
  });

  /* ================= Boot ================= */
  await loadConversations();
  const initial = idFromPath();
  if (initial) openConversation(initial, false);
})();
