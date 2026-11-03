(() => {
  'use strict';

  const STORAGE_KEY = 'meld-ai-browser-preview-v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const app = {
    chats: [],
    activeChatId: null,
    theme: 'dark',
    searchOpen: false,
    searchQuery: '',
    pendingFiles: [],
    speechRecognition: null,
    isRecording: false,
    responseTimer: null,
    busy: false
  };

  const els = {
    body: document.body,
    sidebar: $('#sidebar'),
    sidebarScrim: $('#sidebarScrim'),
    chatHistory: $('#chatHistory'),
    historyCount: $('#historyCount'),
    searchBox: $('#searchBox'),
    chatSearchInput: $('#chatSearchInput'),
    clearSearchBtn: $('#clearSearchBtn'),
    currentChatTitle: $('#currentChatTitle'),
    welcomeScreen: $('#welcomeScreen'),
    messagesWrap: $('#messagesWrap'),
    messagesList: $('#messagesList'),
    conversationScroll: $('#conversationScroll'),
    composerForm: $('#composerForm'),
    messageInput: $('#messageInput'),
    sendBtn: $('#sendBtn'),
    attachmentTray: $('#attachmentTray'),
    fileInput: $('#fileInput'),
    settingsModal: $('#settingsModal'),
    toastRegion: $('#toastRegion'),
    themeIcon: $('#themeIcon')
  };

  function uid() {
    return (window.crypto && typeof window.crypto.randomUUID === 'function')
      ? window.crypto.randomUUID()
      : `meld-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function safeLoad() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return;
      app.chats = Array.isArray(data.chats) ? data.chats.filter(isValidChat) : [];
      app.activeChatId = typeof data.activeChatId === 'string' ? data.activeChatId : null;
      app.theme = data.theme === 'light' ? 'light' : 'dark';
      if (app.activeChatId && !app.chats.some(chat => chat.id === app.activeChatId)) app.activeChatId = null;
    } catch (error) {
      console.warn('Meld AI could not read saved browser data:', error);
      app.chats = [];
      app.activeChatId = null;
    }
  }

  function isValidChat(chat) {
    return !!chat && typeof chat.id === 'string' && typeof chat.title === 'string' && Array.isArray(chat.messages);
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ chats: app.chats, activeChatId: app.activeChatId, theme: app.theme }));
    } catch (error) {
      console.warn('Meld AI could not save to browser storage:', error);
      toast('Your browser storage is full or unavailable. Export your chats to keep a backup.', 'error');
    }
  }

  function getActiveChat() {
    return app.chats.find(chat => chat.id === app.activeChatId) || null;
  }

  function createChat() {
    const chat = { id: uid(), title: 'New chat', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] };
    app.chats.unshift(chat);
    app.activeChatId = chat.id;
    app.searchQuery = '';
    app.chatSearchInput.value = '';
    closeSearch();
    app.pendingFiles = [];
    renderAll();
    persist();
    closeSidebar();
    els.messageInput.focus();
  }

  function setActiveChat(id) {
    if (!app.chats.some(chat => chat.id === id)) return;
    app.activeChatId = id;
    app.pendingFiles = [];
    renderAll();
    persist();
    closeSidebar();
  }

  function deleteChat(id) {
    const index = app.chats.findIndex(chat => chat.id === id);
    if (index < 0) return;
    app.chats.splice(index, 1);
    if (app.activeChatId === id) app.activeChatId = app.chats[0]?.id || null;
    renderAll();
    persist();
    toast('Conversation deleted.', 'success');
  }

  function renameChat(id) {
    const chat = app.chats.find(item => item.id === id);
    if (!chat) return;
    const name = window.prompt('Rename conversation', chat.title);
    if (name === null) return;
    const clean = name.trim().slice(0, 70);
    if (!clean) return toast('A chat title cannot be empty.', 'error');
    chat.title = clean;
    chat.updatedAt = new Date().toISOString();
    renderAll();
    persist();
  }

  function closeSearch() {
    app.searchOpen = false;
    els.searchBox.hidden = true;
    $('#searchToggleBtn').classList.remove('active');
  }

  function toggleSearch() {
    app.searchOpen = !app.searchOpen;
    els.searchBox.hidden = !app.searchOpen;
    if (app.searchOpen) {
      els.chatSearchInput.focus();
    } else {
      app.searchQuery = '';
      els.chatSearchInput.value = '';
      renderHistory();
    }
  }

  function closeSidebarIfMobile() {
    if (window.matchMedia('(max-width: 760px)').matches) closeSidebar();
  }

  function openSidebar() {
    els.sidebar.classList.add('open');
    els.sidebarScrim.classList.add('visible');
  }

  function closeSidebar() {
    els.sidebar.classList.remove('open');
    els.sidebarScrim.classList.remove('visible');
  }

  function renderAll() {
    renderHistory();
    renderConversation();
    renderTheme();
    renderAttachments();
    updateComposer();
  }

  function renderHistory() {
    const query = app.searchQuery.trim().toLowerCase();
    const chats = [...app.chats].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const filtered = chats.filter(chat => !query || chat.title.toLowerCase().includes(query) || chat.messages.some(message => String(message.content || '').toLowerCase().includes(query)));
    els.historyCount.textContent = String(app.chats.length);
    if (!filtered.length) {
      els.chatHistory.innerHTML = `<div class="empty-history">${query ? 'No conversations match that search.' : 'Your conversations will appear here.'}</div>`;
      return;
    }
    els.chatHistory.innerHTML = filtered.map(chat => `
      <div class="history-item ${chat.id === app.activeChatId ? 'active' : ''}" data-chat-id="${escapeAttr(chat.id)}">
        <span class="history-chat-icon" aria-hidden="true">◷</span>
        <button class="history-name" data-action="open-chat" data-chat-id="${escapeAttr(chat.id)}" title="${escapeAttr(chat.title)}">${escapeHtml(chat.title)}</button>
        <button class="history-menu" data-action="chat-menu" data-chat-id="${escapeAttr(chat.id)}" aria-label="Conversation options" title="Conversation options">···</button>
      </div>`).join('');
  }

  function renderConversation() {
    const chat = getActiveChat();
    els.currentChatTitle.textContent = chat ? chat.title : 'New chat';
    if (!chat || chat.messages.length === 0) {
      els.welcomeScreen.hidden = false;
      els.messagesWrap.hidden = true;
      els.messagesList.innerHTML = '';
      return;
    }
    els.welcomeScreen.hidden = true;
    els.messagesWrap.hidden = false;
    els.messagesList.innerHTML = chat.messages.map((message, index) => renderMessage(message, chat, index)).join('');
    scrollToBottom(false);
  }

  function renderMessage(message, chat, index) {
    const isUser = message.role === 'user';
    const isLastAssistant = !isUser && index === chat.messages.length - 1;
    const content = renderMarkdown(String(message.content || ''));
    const files = Array.isArray(message.attachments) && message.attachments.length
      ? `<div class="message-attachments">${message.attachments.map(file => `<span class="message-attachment">▧ ${escapeHtml(file.name)} · ${formatBytes(file.size)}</span>`).join('')}</div>` : '';
    let actions = '';
    if (!isUser) {
      actions = `<div class="message-actions">
        <button class="message-action" data-action="copy-message" data-message-id="${escapeAttr(message.id)}" title="Copy response" aria-label="Copy response">▢</button>
        <button class="message-action ${message.feedback === 'up' ? 'selected' : ''}" data-action="feedback" data-value="up" data-message-id="${escapeAttr(message.id)}" title="Helpful" aria-label="Helpful">↑</button>
        <button class="message-action ${message.feedback === 'down' ? 'selected' : ''}" data-action="feedback" data-value="down" data-message-id="${escapeAttr(message.id)}" title="Not helpful" aria-label="Not helpful">↓</button>
        ${isLastAssistant ? `<button class="message-action" data-action="regenerate" title="Regenerate response" aria-label="Regenerate response">↻</button>` : ''}
      </div>`;
    } else {
      actions = `<div class="message-actions"><button class="message-action" data-action="edit-message" data-message-id="${escapeAttr(message.id)}" title="Edit message" aria-label="Edit message">✎ Edit</button></div>`;
    }
    return `<article class="message-row ${isUser ? 'user' : 'assistant'}" data-message-id="${escapeAttr(message.id)}">
      <div class="message-avatar" aria-hidden="true">${isUser ? 'Y' : '<span class="brand-mark"><span></span><span></span><span></span></span>'}</div>
      <div class="message-main">
        <div class="message-meta"><span class="message-author">${isUser ? 'You' : 'Meld AI'}</span><span class="message-time">${formatTime(message.createdAt)}</span></div>
        <div class="message-content">${content}</div>${files}${actions}
      </div>
    </article>`;
  }

  function renderMarkdown(input) {
    const normalized = input.replace(/\r\n?/g, '\n');
    const chunks = normalized.split(/```/);
    return chunks.map((chunk, index) => {
      if (index % 2 === 1) {
        const firstBreak = chunk.indexOf('\n');
        let language = 'code';
        let code = chunk;
        if (firstBreak >= 0 && /^[\w+-]{1,24}$/.test(chunk.slice(0, firstBreak).trim())) {
          language = chunk.slice(0, firstBreak).trim();
          code = chunk.slice(firstBreak + 1);
        }
        const id = uid();
        return `<div class="code-block"><div class="code-block-head"><span>${escapeHtml(language)}</span><button class="code-copy" data-action="copy-code" data-code-id="${escapeAttr(id)}">Copy code</button></div><pre><code id="${escapeAttr(id)}">${escapeHtml(code.replace(/^\n|\n$/g, ''))}</code></pre></div>`;
      }
      return formatInlineMarkdown(chunk);
    }).join('');
  }

  function formatInlineMarkdown(text) {
    const lines = text.split('\n');
    const output = [];
    let paragraph = [];
    let list = [];
    const flushParagraph = () => {
      if (paragraph.length) {
        output.push(`<p>${formatInline(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`);
        paragraph = [];
      }
    };
    const flushList = () => {
      if (list.length) {
        output.push(`<ul>${list.map(item => `<li>${formatInline(item)}</li>`).join('')}</ul>`);
        list = [];
      }
    };
    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
      if (!line.trim()) { flushParagraph(); flushList(); continue; }
      if (heading) { flushParagraph(); flushList(); const level = heading[1].length; output.push(`<h${level}>${formatInline(heading[2])}</h${level}>`); continue; }
      if (bullet) { flushParagraph(); list.push(bullet[1]); continue; }
      flushList();
      if (line.startsWith('> ')) { flushParagraph(); output.push(`<blockquote>${formatInline(line.slice(2))}</blockquote>`); continue; }
      paragraph.push(line);
    }
    flushParagraph(); flushList();
    return output.join('');
  }

  function formatInline(text) {
    let value = escapeHtml(text);
    value = value.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    value = value.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    value = value.replace(/(^|\s)\*(?!\s)(.+?)\*(?=\s|$)/g, '$1<em>$2</em>');
    value = value.replace(/(https:\/\/[^\s<]+)/g, url => {
      const clean = url.replace(/[),.!?]+$/, '');
      const suffix = url.slice(clean.length);
      return `<a href="${escapeAttr(clean)}" target="_blank" rel="noopener noreferrer">${clean}</a>${suffix}`;
    });
    return value;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  function escapeAttr(value) { return escapeHtml(value).replace(/`/g, '&#96;'); }

  function renderTheme() {
    els.body.classList.toggle('theme-light', app.theme === 'light');
    els.themeIcon.textContent = app.theme === 'light' ? '☀' : '☾';
    $$('.theme-option').forEach(button => button.classList.toggle('active', button.dataset.themeChoice === app.theme));
  }

  function renderAttachments() {
    if (!app.pendingFiles.length) {
      els.attachmentTray.hidden = true;
      els.attachmentTray.innerHTML = '';
      return;
    }
    els.attachmentTray.hidden = false;
    els.attachmentTray.innerHTML = app.pendingFiles.map((file, index) => `<div class="attachment-chip"><span>▧ ${escapeHtml(file.name)}</span><button type="button" data-action="remove-file" data-index="${index}" aria-label="Remove ${escapeAttr(file.name)}">×</button></div>`).join('');
  }

  function updateComposer() {
    els.sendBtn.disabled = !els.messageInput.value.trim() && !app.pendingFiles.length;
    els.sendBtn.title = app.busy ? 'Please wait' : 'Send message';
  }

  function resizeInput() {
    els.messageInput.style.height = 'auto';
    els.messageInput.style.height = `${Math.min(els.messageInput.scrollHeight, 175)}px`;
    updateComposer();
  }

  function formatTime(value) {
    const date = new Date(value || Date.now());
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function formatBytes(size) {
    if (!Number.isFinite(size)) return 'file';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function scrollToBottom(smooth = true) {
    requestAnimationFrame(() => {
      els.conversationScroll.scrollTo({ top: els.conversationScroll.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    });
  }

  function toast(message, type = '') {
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    els.toastRegion.appendChild(node);
    window.setTimeout(() => node.remove(), 3400);
  }

  function addMessage(chat, role, content, attachments = []) {
    const message = { id: uid(), role, content, attachments, createdAt: new Date().toISOString(), feedback: null };
    chat.messages.push(message);
    chat.updatedAt = message.createdAt;
    if (role === 'user' && chat.title === 'New chat') chat.title = makeTitle(content || attachments.map(file => file.name).join(', '));
    persist();
    renderAll();
    return message;
  }

  function makeTitle(text) {
    const clean = String(text).replace(/^\/(\w+)\s*/, '').replace(/\s+/g, ' ').trim();
    return (clean || 'New chat').slice(0, 42) + (clean.length > 42 ? '…' : '');
  }

  function sendCurrentMessage() {
    if (app.busy) return;
    const text = els.messageInput.value.trim();
    const files = app.pendingFiles.map(file => ({ name: file.name, size: file.size, type: file.type || 'application/octet-stream' }));
    if (!text && !files.length) return;
    let chat = getActiveChat();
    if (!chat) {
      chat = { id: uid(), title: 'New chat', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] };
      app.chats.unshift(chat);
      app.activeChatId = chat.id;
    }
    let message = text;
    if (!message && files.length) message = 'I added file attachments. Can you work with these?';
    if (files.length) message += `\n\n[Local preview: ${files.length} file${files.length === 1 ? '' : 's'} attached. The files are not uploaded or analyzed.]`;
    addMessage(chat, 'user', message, files);
    app.pendingFiles = [];
    els.messageInput.value = '';
    resizeInput();
    renderAttachments();
    showTyping();
    app.busy = true;
    updateComposer();
    const currentChatId = chat.id;
    window.setTimeout(() => {
      const active = app.chats.find(item => item.id === currentChatId);
      if (!active) { app.busy = false; removeTyping(); return; }
      const reply = localAssistantReply(text, files);
      removeTyping();
      app.busy = false;
      addMessage(active, 'assistant', reply);
      updateComposer();
    }, 360);
  }

  function showTyping() {
    removeTyping();
    const node = document.createElement('div');
    node.className = 'message-row assistant';
    node.id = 'typingRow';
    node.innerHTML = `<div class="message-avatar"><span class="brand-mark"><span></span><span></span><span></span></span></div><div class="message-main"><div class="message-meta"><span class="message-author">Meld AI</span><span class="message-time">thinking locally</span></div><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
    els.messagesList.appendChild(node);
    els.welcomeScreen.hidden = true;
    els.messagesWrap.hidden = false;
    scrollToBottom();
  }
  function removeTyping() { $('#typingRow')?.remove(); }

  function localAssistantReply(rawText, files = []) {
    const text = String(rawText || '').trim();
    const commandMatch = text.match(/^\/(\w+)(?:\s+([\s\S]*))?$/);
    const command = commandMatch ? commandMatch[1].toLowerCase() : '';
    const argument = commandMatch ? (commandMatch[2] || '').trim() : '';

    if (files.length && !text.replace(/\n?\[Local preview:[\s\S]*$/, '').trim()) {
      return `I can display the attached file names in this preview, but I **cannot open, read, or analyze file contents** here. Nothing was uploaded.\n\nTo analyze documents or images, Meld AI would need a connected AI service and a secure file-processing route.`;
    }
    if (command === 'help' || /^(help|what can you do\??|what works here\??)$/i.test(text)) {
      return `## What works in this browser preview\n\n- **` + '`/calc 128 * 24`' + `** — evaluate a basic math expression.\n- **` + '`/time`' + `** — show your device's current date and time.\n- **` + '`/wordcount your text`' + `** — count words and characters.\n- **` + '`/uppercase your text`' + `** — convert text to uppercase.\n- **` + '`/reverse your text`' + `** — reverse a line of text.\n- Save, search, rename, edit, delete, and export conversations.\n- Switch themes, attach local file labels, and use voice dictation where your browser supports it.\n\n**What is not connected:** ChatGPT model replies, web search, image generation, cloud file analysis, account sync, and external tools. General questions need a real AI connection; this preview will not invent an answer.`;
    }
    if (command === 'time' || /^(what time is it\??|what(?:'s| is) the date\??|what day is it\??)$/i.test(text)) {
      const now = new Date();
      return `Your device's local date and time is **${now.toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })}**.`;
    }
    if (command === 'calc' || /^((what is|calculate|compute)\s+)?[-+]?\d[\d\s().,+*/%^%-]*[=?]?$/.test(text)) {
      const expression = (command === 'calc' ? argument : text.replace(/^(what is|calculate|compute)\s+/i, '')).replace(/=\s*$/, '').trim();
      try {
        const result = evaluateMath(expression);
        return `**${expression} = ${Number.isInteger(result) ? result : Number(result.toPrecision(12))}**\n\nCalculated locally in your browser.`;
      } catch (error) {
        return `I couldn't evaluate that expression. Try a format like **` + '`/calc (18 + 6) * 4`' + `**. Supported operators: +, −, ×, ÷, %, ^, and parentheses.`;
      }
    }
    if (command === 'wordcount') {
      const target = argument;
      if (!target) return 'Add the text after the command, like **`/wordcount paste your paragraph here`**.';
      const words = target.trim() ? target.trim().split(/\s+/).length : 0;
      return `**Word count:** ${words}\n\n**Characters (including spaces):** ${target.length}\n\n**Characters (excluding spaces):** ${target.replace(/\s/g, '').length}`;
    }
    if (command === 'uppercase') return argument ? `\`${argument.toUpperCase()}\`` : 'Add text after **`/uppercase`**.';
    if (command === 'reverse') return argument ? `\`${Array.from(argument).reverse().join('')}\`` : 'Add text after **`/reverse`**.';
    if (/^\s*\d+(?:\.\d+)?\s*[+*/%^()-]\s*\d/.test(text)) {
      try {
        const result = evaluateMath(text);
        return `**${text} = ${Number.isInteger(result) ? result : Number(result.toPrecision(12))}**\n\nCalculated locally in your browser.`;
      } catch (_) { /* fall through to the connection notice */ }
    }

    return `I received your message and saved it in this browser. **The ChatGPT model is not connected in this version**, so I can't generate a genuine AI response to general questions.\n\nYou can try **` + '`/help`' + `** to see the local commands that are available. No API key was requested, and your message was not sent to a server.`;
  }

  function evaluateMath(source) {
    const input = String(source).replace(/,/g, '').replace(/\s+/g, '');
    if (!input || input.length > 100 || !/^[0-9.+\-*/%^()]+$/.test(input)) throw new Error('Invalid expression');
    const tokens = input.match(/\d*\.?\d+|[()+\-*/%^]/g) || [];
    if (tokens.join('') !== input) throw new Error('Invalid token');
    let position = 0;
    const peek = () => tokens[position];
    const take = () => tokens[position++];
    function primary() {
      const token = take();
      if (token === '+') return primary();
      if (token === '-') return -primary();
      if (token === '(') {
        const value = expression();
        if (take() !== ')') throw new Error('Missing parenthesis');
        return value;
      }
      if (!token || !/^\d*\.?\d+$/.test(token)) throw new Error('Expected number');
      return Number(token);
    }
    function power() {
      const left = primary();
      return peek() === '^' ? (take(), Math.pow(left, power())) : left;
    }
    function term() {
      let value = power();
      while (peek() === '*' || peek() === '/' || peek() === '%') {
        const operator = take(); const right = power();
        if ((operator === '/' || operator === '%') && right === 0) throw new Error('Division by zero');
        if (operator === '*') value *= right;
        if (operator === '/') value /= right;
        if (operator === '%') value %= right;
      }
      return value;
    }
    function expression() {
      let value = term();
      while (peek() === '+' || peek() === '-') {
        const operator = take(); const right = term();
        value = operator === '+' ? value + right : value - right;
      }
      return value;
    }
    const result = expression();
    if (position !== tokens.length || !Number.isFinite(result)) throw new Error('Invalid result');
    return result;
  }

  function regenerateLast() {
    const chat = getActiveChat();
    if (!chat || app.busy) return;
    let lastUserIndex = -1;
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === 'user') { lastUserIndex = i; break; }
    }
    if (lastUserIndex < 0) return;
    const source = chat.messages[lastUserIndex];
    chat.messages = chat.messages.slice(0, lastUserIndex + 1);
    chat.updatedAt = new Date().toISOString();
    persist(); renderAll(); showTyping(); app.busy = true;
    window.setTimeout(() => {
      const reply = localAssistantReply(source.content.replace(/\n\n\[Local preview:[\s\S]*$/, ''), source.attachments || []);
      removeTyping(); app.busy = false; addMessage(chat, 'assistant', reply); updateComposer();
    }, 330);
  }

  function editMessage(id) {
    const chat = getActiveChat();
    if (!chat) return;
    const index = chat.messages.findIndex(message => message.id === id && message.role === 'user');
    if (index < 0) return;
    const original = chat.messages[index];
    const edited = window.prompt('Edit your message', original.content.replace(/\n\n\[Local preview:[\s\S]*$/, ''));
    if (edited === null) return;
    const clean = edited.trim();
    if (!clean) return toast('Your message cannot be empty.', 'error');
    original.content = clean;
    original.createdAt = new Date().toISOString();
    chat.messages = chat.messages.slice(0, index + 1);
    chat.updatedAt = original.createdAt;
    persist(); renderAll(); regenerateLast();
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.appendChild(area); area.select();
        const ok = document.execCommand('copy'); area.remove(); if (!ok) throw new Error('Copy failed');
      }
      toast('Copied to clipboard.', 'success');
    } catch (error) { toast('Could not copy. Your browser may block clipboard access.', 'error'); }
  }

  function exportChat(chat) {
    if (!chat) return toast('There is no conversation to export.', 'error');
    const lines = [`# ${chat.title}`, `Exported: ${new Date().toLocaleString()}`, ''];
    chat.messages.forEach(message => {
      lines.push(`${message.role === 'user' ? 'You' : 'Meld AI'} · ${new Date(message.createdAt).toLocaleString()}`);
      lines.push(message.content || '');
      if (message.attachments?.length) lines.push(`Attachments (names only): ${message.attachments.map(file => file.name).join(', ')}`);
      lines.push('');
    });
    downloadBlob(lines.join('\n'), `${slugify(chat.title)}.txt`, 'text/plain;charset=utf-8');
  }

  function exportAllChats() {
    const backup = { app: 'Meld AI Browser Preview', exportedAt: new Date().toISOString(), chats: app.chats };
    downloadBlob(JSON.stringify(backup, null, 2), 'meld-ai-backup.json', 'application/json;charset=utf-8');
  }

  function downloadBlob(content, filename, type) {
    try {
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1200);
      toast('Export ready.', 'success');
    } catch (error) { toast('The export could not be created.', 'error'); }
  }
  function slugify(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'meld-chat'; }

  function openSettings() { els.settingsModal.hidden = false; renderTheme(); $('#closeSettingsBtn').focus(); }
  function closeSettings() { els.settingsModal.hidden = true; $('#settingsBtn').focus(); }

  function handleFileSelection(fileList) {
    const files = Array.from(fileList || []);
    const tooLarge = files.filter(file => file.size > 20 * 1024 * 1024);
    const allowed = files.filter(file => file.size <= 20 * 1024 * 1024);
    if (tooLarge.length) toast('Files over 20 MB were skipped.', 'error');
    app.pendingFiles.push(...allowed);
    if (app.pendingFiles.length > 8) { app.pendingFiles = app.pendingFiles.slice(0, 8); toast('A maximum of 8 files can be attached at once.'); }
    renderAttachments(); updateComposer();
    if (allowed.length) toast('File names added. Files stay on your device and are not uploaded.');
    els.fileInput.value = '';
  }

  function startVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return toast('Voice input is not supported by this browser. Try a browser with speech recognition support.', 'error');
    if (app.isRecording && app.speechRecognition) { app.speechRecognition.stop(); return; }
    const recognition = new SpeechRecognition();
    app.speechRecognition = recognition;
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => { app.isRecording = true; $('#voiceBtn').classList.add('selected'); toast('Listening…'); };
    recognition.onresult = event => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      els.messageInput.value = `${els.messageInput.value}${els.messageInput.value ? ' ' : ''}${transcript}`;
      resizeInput();
    };
    recognition.onerror = event => toast(`Voice input error: ${event.error || 'unknown error'}.`, 'error');
    recognition.onend = () => { app.isRecording = false; $('#voiceBtn').classList.remove('selected'); app.speechRecognition = null; };
    try { recognition.start(); } catch (error) { toast('Voice input could not start.', 'error'); }
  }

  // UI event handlers
  $('#newChatBtn').addEventListener('click', createChat);
  $('#brandHome').addEventListener('click', event => { event.preventDefault(); createChat(); });
  $('#searchToggleBtn').addEventListener('click', toggleSearch);
  els.chatSearchInput.addEventListener('input', () => { app.searchQuery = els.chatSearchInput.value; renderHistory(); });
  els.chatSearchInput.addEventListener('keydown', event => { if (event.key === 'Escape') { closeSearch(); app.searchQuery = ''; els.chatSearchInput.value = ''; renderHistory(); } });
  els.clearSearchBtn.addEventListener('click', () => { els.chatSearchInput.value = ''; app.searchQuery = ''; renderHistory(); els.chatSearchInput.focus(); });
  els.chatHistory.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = button.dataset.chatId;
    if (button.dataset.action === 'open-chat') setActiveChat(id);
    if (button.dataset.action === 'chat-menu') {
      const choice = window.prompt('Conversation options: type "rename" or "delete"', 'rename');
      if (choice === null) return;
      if (choice.trim().toLowerCase() === 'rename') renameChat(id);
      else if (choice.trim().toLowerCase() === 'delete') {
        if (window.confirm('Delete this conversation? This cannot be undone.')) deleteChat(id);
      } else toast('Choose rename or delete.', 'error');
    }
  });
  els.messagesList.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const chat = getActiveChat();
    if (!chat) return;
    const action = button.dataset.action;
    if (action === 'copy-message') {
      const message = chat.messages.find(item => item.id === button.dataset.messageId);
      if (message) copyText(message.content);
    }
    if (action === 'copy-code') {
      const code = document.getElementById(button.dataset.codeId);
      if (code) copyText(code.textContent);
    }
    if (action === 'feedback') {
      const message = chat.messages.find(item => item.id === button.dataset.messageId);
      if (message) { message.feedback = message.feedback === button.dataset.value ? null : button.dataset.value; persist(); renderConversation(); }
    }
    if (action === 'regenerate') regenerateLast();
    if (action === 'edit-message') editMessage(button.dataset.messageId);
  });
  $('#starterGrid').addEventListener('click', event => {
    const card = event.target.closest('[data-prompt]');
    if (card) { els.messageInput.value = card.dataset.prompt; resizeInput(); sendCurrentMessage(); }
  });
  els.messagesList.addEventListener('click', event => {
    const remove = event.target.closest('[data-action="remove-file"]');
    if (remove) { app.pendingFiles.splice(Number(remove.dataset.index), 1); renderAttachments(); updateComposer(); }
  });
  els.attachmentTray.addEventListener('click', event => {
    const button = event.target.closest('[data-action="remove-file"]');
    if (button) { app.pendingFiles.splice(Number(button.dataset.index), 1); renderAttachments(); updateComposer(); }
  });
  els.composerForm.addEventListener('submit', event => { event.preventDefault(); sendCurrentMessage(); });
  els.messageInput.addEventListener('input', resizeInput);
  els.messageInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendCurrentMessage(); }
  });
  $('#attachBtn').addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', event => handleFileSelection(event.target.files));
  $('#voiceBtn').addEventListener('click', startVoiceInput);
  $('#themeToggleBtn').addEventListener('click', () => { app.theme = app.theme === 'dark' ? 'light' : 'dark'; renderTheme(); persist(); });
  $$('.theme-option').forEach(button => button.addEventListener('click', () => { app.theme = button.dataset.themeChoice; renderTheme(); persist(); }));
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#closeSettingsBtn').addEventListener('click', closeSettings);
  $('#settingsDoneBtn').addEventListener('click', closeSettings);
  els.settingsModal.addEventListener('click', event => { if (event.target === els.settingsModal) closeSettings(); });
  $('#exportCurrentBtn').addEventListener('click', () => exportChat(getActiveChat()));
  $('#exportAllBtn').addEventListener('click', exportAllChats);
  $('#clearAllBtn').addEventListener('click', () => {
    if (!app.chats.length) return toast('There are no chats to clear.');
    if (!window.confirm('Clear every saved conversation from this browser? This cannot be undone.')) return;
    app.chats = []; app.activeChatId = null; persist(); renderAll(); toast('All conversations cleared.', 'success');
  });
  $('#openSidebarBtn').addEventListener('click', openSidebar);
  $('#closeSidebarBtn').addEventListener('click', closeSidebar);
  els.sidebarScrim.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', event => {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const mod = isMac ? event.metaKey : event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'k') { event.preventDefault(); createChat(); }
    if (mod && event.key.toLowerCase() === 'f') { event.preventDefault(); if (!app.searchOpen) toggleSearch(); else els.chatSearchInput.focus(); }
    if (event.key === 'Escape') {
      if (!els.settingsModal.hidden) closeSettings();
      closeSidebar();
    }
  });
  window.addEventListener('resize', () => { if (!window.matchMedia('(max-width: 760px)').matches) closeSidebar(); });

  // Initialize without requiring a login, API key, build step, or external package.
  safeLoad();
  renderAll();
  resizeInput();
})();
