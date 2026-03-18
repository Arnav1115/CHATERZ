(() => {
  const socket = io();

  const backdrop = document.getElementById('backdrop');
  const usernameInput = document.getElementById('usernameInput');
  const joinButton = document.getElementById('joinButton');
  const profileName = document.getElementById('profileName');
  const profileAvatar = document.getElementById('profileAvatar');
  const usersList = document.getElementById('usersList');
  const usersCount = document.getElementById('usersCount');
  const userSearchInput = document.getElementById('userSearchInput');
  const roomsList = document.getElementById('roomsList');
  const roomsCount = document.getElementById('roomsCount');
  const roomNameInput = document.getElementById('roomNameInput');
  const statusList = document.getElementById('statusList');
  const statusCount = document.getElementById('statusCount');
  const statusTextInput = document.getElementById('statusTextInput');
  const statusFileInput = document.getElementById('statusFileInput');
  const statusAttachBtn = document.getElementById('statusAttachBtn');
  const postStatusBtn = document.getElementById('postStatusBtn');

  const tabChats = document.getElementById('tabChats');
  const tabRooms = document.getElementById('tabRooms');
  const tabStatus = document.getElementById('tabStatus');
  const panelChats = document.getElementById('panelChats');
  const panelRooms = document.getElementById('panelRooms');
  const panelStatus = document.getElementById('panelStatus');
  const messagesEl = document.getElementById('messages');
  const messageInput = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton');
  const attachButton = document.getElementById('attachButton');
  const fileInput = document.getElementById('fileInput');
  const typingIndicator = document.getElementById('typingIndicator');
  const themeToggle = document.getElementById('themeToggle');
  const emojiToggle = document.getElementById('emojiToggle');
  const emojiPanel = document.getElementById('emojiPanel');
  const chatTargetLabel = document.getElementById('chatTargetLabel');
  const chatTargetSubLabel = document.getElementById('chatTargetSubLabel');
  const messageSearchInput = document.getElementById('messageSearchInput');
  const connStatus = document.getElementById('connStatus');
  const voiceCallBtn = document.getElementById('voiceCallBtn');
  const videoCallBtn = document.getElementById('videoCallBtn');
  const hangupBtn = document.getElementById('hangupBtn');

  const callOverlay = document.getElementById('callOverlay');
  const callTitle = document.getElementById('callTitle');
  const callSubtitle = document.getElementById('callSubtitle');
  const callCloseBtn = document.getElementById('callCloseBtn');
  const remoteVideo = document.getElementById('remoteVideo');
  const localVideo = document.getElementById('localVideo');
  const toggleMicBtn = document.getElementById('toggleMicBtn');
  const toggleCamBtn = document.getElementById('toggleCamBtn');
  const endCallBtn = document.getElementById('endCallBtn');

  const incomingCallModal = document.getElementById('incomingCallModal');
  const incomingTitle = document.getElementById('incomingTitle');
  const incomingSubtitle = document.getElementById('incomingSubtitle');
  const acceptCallBtn = document.getElementById('acceptCallBtn');
  const rejectCallBtn = document.getElementById('rejectCallBtn');

  let username = '';
  let currentTarget = 'all'; // 'all' or username string
  let currentRoom = 'public';
  let isTyping = false;
  let typingTimeout = null;
  let pingAudio = null;
  let pendingFile = null;
  let allOnlineUsers = []; // [{username, avatarSeed, lastSeen, online}]
  let rooms = [];
  let statuses = [];
  let pendingStatusFile = null;
  let messageSearchQuery = '';
  const messageIndex = new Map(); // messageId -> { message, elements }

  // Call state (WebRTC is wired up after server signaling is added)
  let callState = {
    active: false,
    peer: null,
    mode: null, // 'voice' | 'video'
    direction: null // 'outgoing' | 'incoming'
  };

  let pc = null;
  let localStream = null;
  let remoteStream = null;
  let incomingOffer = null; // { from, mode, offer }

  const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  try {
    pingAudio = new Audio('assets/ping.mp3');
  } catch (e) {
    pingAudio = null;
  }

  function applyTheme(initial = false) {
    const stored = localStorage.getItem('chat-theme');
    const prefersDark =
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;

    const useDark = stored === 'dark' || (!stored && prefersDark);

    if (useDark) {
      document.body.classList.add('dark');
      themeToggle.textContent = '☀️';
    } else {
      document.body.classList.remove('dark');
      themeToggle.textContent = '🌙';
    }

    if (initial && !stored) {
      localStorage.setItem('chat-theme', useDark ? 'dark' : 'light');
    }
  }

  applyTheme(true);

  themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    const isDark = document.body.classList.contains('dark');
    themeToggle.textContent = isDark ? '☀️' : '🌙';
    localStorage.setItem('chat-theme', isDark ? 'dark' : 'light');
  });

  usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      joinChat();
    }
  });

  joinButton.addEventListener('click', () => {
    joinChat();
  });

  function joinChat() {
    const raw = usernameInput.value.trim();
    if (!raw) {
      usernameInput.focus();
      return;
    }

    username = raw;
    localStorage.setItem('chat-username', username);
    socket.emit('join', { username, avatarSeed: username, silent: false }, (res) => {
      if (res && res.error) {
        alert(res.error);
        return;
      }

      profileName.textContent = username;
      profileAvatar.setAttribute('title', username);
      backdrop.classList.add('hidden');
      messageInput.focus();
    });
  }

  // Auto-rejoin on reconnect (common on Render/production)
  socket.on('connect', () => {
    if (connStatus) {
      connStatus.textContent = 'Online';
      connStatus.classList.add('ok');
      connStatus.classList.remove('bad');
    }
    const stored = localStorage.getItem('chat-username');
    if (stored && !username) {
      username = stored;
      profileName.textContent = username;
      profileAvatar.setAttribute('title', username);
      backdrop.classList.add('hidden');
    }

    if (username) {
      socket.emit('join', { username, avatarSeed: username, silent: true });
    }
  });

  function setTab(which) {
    [tabChats, tabRooms, tabStatus].forEach((b) => b && b.classList.remove('active'));
    [panelChats, panelRooms, panelStatus].forEach((p) => p && p.classList.add('hidden'));
    if (which === 'chats') {
      tabChats.classList.add('active');
      panelChats.classList.remove('hidden');
    } else if (which === 'rooms') {
      tabRooms.classList.add('active');
      panelRooms.classList.remove('hidden');
    } else {
      tabStatus.classList.add('active');
      panelStatus.classList.remove('hidden');
    }
  }

  tabChats && tabChats.addEventListener('click', () => setTab('chats'));
  tabRooms && tabRooms.addEventListener('click', () => setTab('rooms'));
  tabStatus && tabStatus.addEventListener('click', () => {
    setTab('status');
    socket.emit('story:list', (res) => {
      statuses = (res && res.stories) || [];
      renderStatuses();
    });
  });

  socket.on('disconnect', () => {
    if (connStatus) {
      connStatus.textContent = 'Reconnecting...';
      connStatus.classList.remove('ok');
      connStatus.classList.add('bad');
    }
  });

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function renderSystemMessage(text, timestamp) {
    const row = document.createElement('div');
    row.className = 'message-system';
    const t = formatTime(timestamp);
    row.textContent = t ? `${text} • ${t}` : text;
    messagesEl.appendChild(row);
    scrollToBottom();
  }

  function renderMessage(message) {
    const isSelf = message.user === username;

    const row = document.createElement('div');
    row.className = 'message-row' + (isSelf ? ' self' : '');

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    if (message && message._id) {
      bubble.dataset.messageId = message._id;
    }

    // Quick reactions (hover tools)
    const tools = document.createElement('div');
    tools.className = 'reaction-tools';
    ['👍', '❤️', '😂', '🔥', '🎉', '😮'].forEach((emoji) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'reaction-btn';
      btn.textContent = emoji;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!message || !message._id) return;
        socket.emit('message:react', { messageId: message._id, emoji });
      });
      tools.appendChild(btn);
    });
    bubble.appendChild(tools);

    const meta = document.createElement('div');
    meta.className = 'message-meta';

    const userSpan = document.createElement('span');
    userSpan.className = 'message-user';
    userSpan.textContent = isSelf ? 'You' : message.user;

    const leftMeta = document.createElement('div');
    leftMeta.style.display = 'flex';
    leftMeta.style.alignItems = 'baseline';

    leftMeta.appendChild(userSpan);

    if (message.to && message.to !== 'all') {
      const toSpan = document.createElement('span');
      toSpan.className = 'message-to';

      if (isSelf) {
        toSpan.textContent = `(to ${message.to}, DM)`;
      } else if (message.to === username) {
        toSpan.textContent = `(to You, DM)`;
      } else {
        toSpan.textContent = `(DM)`;
      }

      leftMeta.appendChild(toSpan);
    }

    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-time';
    timeSpan.textContent = formatTime(message.timestamp);

    meta.appendChild(leftMeta);
    meta.appendChild(timeSpan);

    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';

    const hasText = message.text && message.text.trim().length > 0;
    if (hasText) {
      const span = document.createElement('div');
      span.textContent = message.text;
      textDiv.appendChild(span);
    }

    if (message.fileUrl) {
      const isImage = message.fileType && message.fileType.startsWith('image/');
      const fileBlock = document.createElement('div');
      fileBlock.style.marginTop = hasText ? '6px' : '0';

      if (isImage) {
        const img = document.createElement('img');
        img.src = message.fileUrl;
        img.alt = message.fileName || 'image';
        img.style.maxWidth = '220px';
        img.style.borderRadius = '10px';
        img.style.display = 'block';
        img.style.cursor = 'pointer';
        img.addEventListener('click', () => {
          window.open(message.fileUrl, '_blank');
        });
        fileBlock.appendChild(img);
      } else {
        const link = document.createElement('a');
        link.href = message.fileUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = message.fileName || 'Download file';
        link.style.color = 'inherit';
        link.style.textDecoration = 'underline';
        fileBlock.appendChild(link);
      }

      textDiv.appendChild(fileBlock);
    }

    bubble.appendChild(meta);
    bubble.appendChild(textDiv);

    // Reactions row
    const reactionsRow = document.createElement('div');
    reactionsRow.className = 'reaction-row';
    bubble.appendChild(reactionsRow);
    row.appendChild(bubble);

    messagesEl.appendChild(row);
    indexMessage(message, row, bubble);
    applyMessageSearch();
    scrollToBottom();

    if (!isSelf && pingAudio) {
      pingAudio.currentTime = 0;
      pingAudio.play().catch(() => {});
    }
  }

  function computeReactionCounts(reactions) {
    const counts = new Map();
    (reactions || []).forEach((r) => {
      if (!r || !r.emoji) return;
      counts.set(r.emoji, (counts.get(r.emoji) || 0) + 1);
    });
    return counts;
  }

  function hasUserReacted(reactions, emoji) {
    return (reactions || []).some((r) => r && r.emoji === emoji && r.user === username);
  }

  function renderReactionsFor(messageId, reactions) {
    const entry = messageIndex.get(messageId);
    if (!entry) return;
    const { reactionsRow } = entry.elements;
    if (!reactionsRow) return;

    reactionsRow.innerHTML = '';
    const counts = computeReactionCounts(reactions);
    if (counts.size === 0) return;

    Array.from(counts.entries()).forEach(([emoji, count]) => {
      const chip = document.createElement('div');
      chip.className = 'reaction-chip' + (hasUserReacted(reactions, emoji) ? ' active' : '');
      chip.textContent = `${emoji} ${count}`;
      chip.addEventListener('click', () => {
        socket.emit('message:react', { messageId, emoji });
      });
      reactionsRow.appendChild(chip);
    });
  }

  function indexMessage(message, row, bubble) {
    if (!message || !message._id) return;
    const reactionsRow = bubble.querySelector('.reaction-row');
    messageIndex.set(message._id, {
      message,
      elements: { row, bubble, reactionsRow }
    });

    // initial reactions
    renderReactionsFor(message._id, message.reactions || []);
  }

  function applyMessageSearch() {
    const q = (messageSearchQuery || '').trim().toLowerCase();
    messageIndex.forEach((entry) => {
      const { message, elements } = entry;
      const hay = `${message.user || ''} ${message.text || ''} ${message.fileName || ''}`.toLowerCase();
      const match = !q || hay.includes(q);
      if (elements.row) {
        elements.row.style.display = match ? '' : 'none';
      }
    });
  }

  if (messageSearchInput) {
    messageSearchInput.addEventListener('input', () => {
      messageSearchQuery = messageSearchInput.value || '';
      applyMessageSearch();
    });
  }

  function updateUsersList(users) {
    allOnlineUsers = users || [];
    renderUsersList();
  }

  function renderUsersList() {
    usersList.innerHTML = '';
    const q = (userSearchInput && userSearchInput.value
      ? userSearchInput.value.trim().toLowerCase()
      : '');

    const uniqueUsers = allOnlineUsers;
    usersCount.textContent = uniqueUsers.length.toString();

    const allItem = document.createElement('li');
    allItem.className = 'user-item' + (currentTarget === 'all' ? ' active' : '');
    allItem.innerHTML = `<span class="user-name">Everyone</span><span class="user-badge">Public</span>`;
    allItem.addEventListener('click', () => {
      currentTarget = 'all';
      refreshUserSelection();
    });
    usersList.appendChild(allItem);

    uniqueUsers
      .filter((u) => u && u.username && u.username !== username)
      .filter((u) => !q || u.username.toLowerCase().includes(q))
      .forEach((u) => {
      const user = u.username;
      const li = document.createElement('li');
      li.className = 'user-item' + (currentTarget === user ? ' active' : '');
      li.dataset.username = user;

      const lastSeen = u.lastSeen ? new Date(u.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      li.innerHTML = `
        <span class="user-name">${user}</span>
        <span class="user-badge">DM • ${lastSeen}</span>
      `;

      li.addEventListener('click', () => {
        currentTarget = user;
        refreshUserSelection();
      });

      usersList.appendChild(li);
    });

    refreshUserSelectionLabels();
  }

  function refreshUserSelection() {
    const items = Array.from(usersList.querySelectorAll('.user-item'));
    items.forEach((item) => {
      const user = item.dataset.username || 'all';
      if (user === currentTarget) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    refreshUserSelectionLabels();
  }

  function refreshUserSelectionLabels() {
    if (currentTarget === 'all') {
      chatTargetLabel.textContent = `#${currentRoom}`;
      chatTargetSubLabel.textContent = `Room chat • everyone in #${currentRoom}`;
      voiceCallBtn.disabled = true;
      videoCallBtn.disabled = true;
    } else {
      chatTargetLabel.textContent = `Direct message to ${currentTarget}`;
      chatTargetSubLabel.textContent = 'Only you and this user can see these messages';
      voiceCallBtn.disabled = false;
      videoCallBtn.disabled = false;
    }
  }

  function renderRooms() {
    if (!roomsList) return;
    roomsList.innerHTML = '';
    roomsCount.textContent = rooms.length.toString();
    rooms.forEach((r) => {
      const li = document.createElement('li');
      li.className = 'user-item' + (currentRoom === r ? ' active' : '');
      li.innerHTML = `<span class="user-name">#${r}</span><span class="user-badge">Room</span>`;
      li.addEventListener('click', () => {
        currentTarget = 'all';
        socket.emit('room:join', { room: r }, (res) => {
          if (res && res.error) return alert(res.error);
          currentRoom = r;
          refreshUserSelection();
          setTab('chats');
        });
      });
      roomsList.appendChild(li);
    });
  }

  socket.emit('rooms:list', (res) => {
    rooms = (res && res.rooms) || ['public'];
    renderRooms();
  });

  roomNameInput && roomNameInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const name = roomNameInput.value.trim().toLowerCase();
    if (!name) return;
    if (!rooms.includes(name)) rooms.unshift(name);
    roomNameInput.value = '';
    renderRooms();
  });

  if (userSearchInput) {
    userSearchInput.addEventListener('input', () => {
      renderUsersList();
    });
  }

  // Call UI helpers (signaling + WebRTC hookup comes next)
  function openCallOverlay(title, subtitle) {
    callTitle.textContent = title || 'Call';
    callSubtitle.textContent = subtitle || '';
    callOverlay.classList.remove('hidden');
    hangupBtn.classList.remove('hidden');
  }

  function closeCallOverlay() {
    callOverlay.classList.add('hidden');
    hangupBtn.classList.add('hidden');
    remoteVideo.srcObject = null;
    localVideo.srcObject = null;
    callSubtitle.textContent = '';
    callTitle.textContent = '';
  }

  function showIncomingCall(fromUser, mode) {
    incomingTitle.textContent = `Incoming ${mode === 'video' ? 'video' : 'voice'} call`;
    incomingSubtitle.textContent = `From ${fromUser}`;
    incomingCallModal.classList.remove('hidden');
  }

  function hideIncomingCall() {
    incomingCallModal.classList.add('hidden');
    incomingSubtitle.textContent = '';
  }

  function endCallUI() {
    callState = { active: false, peer: null, mode: null, direction: null };
    hideIncomingCall();
    closeCallOverlay();
  }

  async function ensurePeerConnection(mode, peer) {
    if (pc) return;

    pc = new RTCPeerConnection(rtcConfig);
    remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach((t) => remoteStream.addTrack(t));
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && peer) {
        socket.emit('call:ice', { to: peer, candidate: event.candidate });
      }
    };

    const constraints =
      mode === 'video'
        ? { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } }
        : { audio: true, video: false };

    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.srcObject = localStream;

    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    toggleCamBtn.disabled = mode !== 'video';
    toggleCamBtn.style.opacity = mode !== 'video' ? '0.5' : '1';
  }

  function setMicEnabled(enabled) {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((t) => (t.enabled = enabled));
    toggleMicBtn.textContent = enabled ? '🎙️' : '🔇';
  }

  function setCamEnabled(enabled) {
    if (!localStream) return;
    localStream.getVideoTracks().forEach((t) => (t.enabled = enabled));
    toggleCamBtn.textContent = enabled ? '📷' : '🚫';
  }

  function cleanupCall() {
    try {
      if (pc) pc.ontrack = null;
      if (pc) pc.onicecandidate = null;
      if (pc) pc.close();
    } catch (_) {}
    pc = null;

    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
    }
    localStream = null;

    remoteStream = null;
    incomingOffer = null;

    endCallUI();
  }

  async function startOutgoingCall(mode) {
    const peer = currentTarget;
    if (!peer || peer === 'all') return;

    callState = { active: true, peer, mode, direction: 'outgoing' };
    openCallOverlay(`Calling ${peer}`, mode === 'video' ? 'Video call' : 'Voice call');

    try {
      await ensurePeerConnection(mode, peer);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit('call:offer', { to: peer, mode, offer }, (res) => {
        if (res && res.error) {
          alert(res.error);
          cleanupCall();
        } else {
          setMicEnabled(true);
          setCamEnabled(mode === 'video');
          callSubtitle.textContent = 'Ringing...';
        }
      });
    } catch (_) {
      alert('Failed to access mic/camera or start call.');
      cleanupCall();
    }
  }

  voiceCallBtn.addEventListener('click', () => {
    if (currentTarget === 'all') return;
    startOutgoingCall('voice');
  });

  videoCallBtn.addEventListener('click', () => {
    if (currentTarget === 'all') return;
    startOutgoingCall('video');
  });

  function endCallFromUI() {
    if (callState.active && callState.peer) {
      socket.emit('call:end', { to: callState.peer });
    }
    cleanupCall();
  }

  hangupBtn.addEventListener('click', () => {
    endCallFromUI();
  });

  callCloseBtn.addEventListener('click', () => {
    endCallFromUI();
  });

  endCallBtn.addEventListener('click', () => {
    endCallFromUI();
  });

  toggleMicBtn.addEventListener('click', () => {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (!track) return;
    setMicEnabled(!track.enabled);
  });

  toggleCamBtn.addEventListener('click', () => {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0];
    if (!track) return;
    setCamEnabled(!track.enabled);
  });

  acceptCallBtn.addEventListener('click', () => {
    hideIncomingCall();
    if (!incomingOffer) return;

    const { from, mode, offer } = incomingOffer;
    callState = { active: true, peer: from, mode, direction: 'incoming' };
    openCallOverlay(`In call with ${from}`, mode === 'video' ? 'Video call' : 'Voice call');

    ensurePeerConnection(mode, from)
      .then(async () => {
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('call:answer', { to: from, accepted: true, answer });
        setMicEnabled(true);
        setCamEnabled(mode === 'video');
      })
      .catch(() => {
        socket.emit('call:answer', { to: from, accepted: false });
        cleanupCall();
        alert('Failed to access mic/camera or start call.');
      });
  });

  rejectCallBtn.addEventListener('click', () => {
    hideIncomingCall();
    if (incomingOffer && incomingOffer.from) {
      socket.emit('call:answer', { to: incomingOffer.from, accepted: false });
    }
    cleanupCall();
  });

  function emitTyping(isCurrentlyTyping) {
    socket.emit('typing', {
      isTyping: isCurrentlyTyping,
      to: currentTarget
    });
  }

  messageInput.addEventListener('input', () => {
    const hasText = messageInput.value.trim().length > 0;

    if (hasText && !isTyping) {
      isTyping = true;
      emitTyping(true);
    }

    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }

    typingTimeout = setTimeout(() => {
      if (isTyping) {
        isTyping = false;
        emitTyping(false);
      }
    }, 900);
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendButton.addEventListener('click', () => {
    sendMessage();
  });

  function sendMessage() {
    const text = messageInput.value.trim();
    const hasText = text.length > 0;
    const hasFile = !!pendingFile;

    if (!hasText && !hasFile) return;

    const sendSocketMessage = (fileMeta) => {
      socket.emit(
        'chat_message',
        {
          text,
          to: currentTarget,
          room: currentTarget === 'all' ? currentRoom : null,
          file: fileMeta
        },
        (res) => {
          if (res && res.error) {
            alert(res.error);
          }
        }
      );

      messageInput.value = '';
      if (fileInput) {
        fileInput.value = '';
      }
      pendingFile = null;

      if (isTyping) {
        isTyping = false;
        emitTyping(false);
      }
    };

    if (hasFile) {
      const formData = new FormData();
      formData.append('file', pendingFile);

      fetch('/api/upload', {
        method: 'POST',
        body: formData
      })
        .then((res) => res.json())
        .then((data) => {
          if (data && data.error) {
            alert(data.error);
            return;
          }
          const fileMeta = {
            url: data.fileUrl,
            name: data.fileName,
            type: data.fileType
          };
          sendSocketMessage(fileMeta);
        })
        .catch(() => {
          alert('Failed to upload file.');
        });
    } else {
      sendSocketMessage(null);
    }
  }

  attachButton.addEventListener('click', (e) => {
    e.preventDefault();
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    pendingFile = file || null;
  });

  emojiToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPanel.classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    emojiPanel.classList.add('hidden');
  });

  emojiPanel.addEventListener('click', (e) => {
    e.stopPropagation();
    const target = e.target;
    if (target.classList.contains('emoji-btn')) {
      messageInput.value += target.textContent;
      messageInput.focus();
      const event = new Event('input');
      messageInput.dispatchEvent(event);
    }
  });

  socket.on('chat_history', (messages) => {
    messagesEl.innerHTML = '';
    messageIndex.clear();
    (messages || []).forEach((msg) => renderMessage(msg));
  });

  socket.on('chat_message', (message) => {
    renderMessage(message);
    // DM delivery ticks
    if (message && message.to === username) {
      socket.emit('message:delivered', { messageId: message._id });
    }
  });

  // DM seen ticks when focusing a DM
  window.addEventListener('focus', () => {
    if (currentTarget !== 'all') {
      const ids = [];
      messageIndex.forEach((entry) => {
        const m = entry.message;
        if (m && m.to === username && m.user === currentTarget && (!m.dmStatus || !m.dmStatus.seenAt)) {
          ids.push(m._id);
        }
      });
      if (ids.length) socket.emit('message:seen', { messageIds: ids });
    }
  });

  socket.on('message:status', (payload) => {
    const { messageId, dmStatus } = payload || {};
    if (!messageId) return;
    const entry = messageIndex.get(messageId);
    if (entry) {
      entry.message.dmStatus = dmStatus;
    }
  });

  function renderStatuses() {
    if (!statusList) return;
    statusList.innerHTML = '';
    statusCount.textContent = (statuses || []).length.toString();
    (statuses || []).forEach((s) => {
      const li = document.createElement('li');
      li.className = 'user-item';
      const t = s.timestamp ? new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      li.innerHTML = `<span class="user-name">${s.user} • ${t}</span><span class="user-badge">View</span>`;
      li.addEventListener('click', () => {
        socket.emit('story:view', { storyId: s._id });
        if (s.fileUrl) window.open(s.fileUrl, '_blank');
        else alert(s.text || 'Status');
      });
      statusList.appendChild(li);
    });
  }

  statusAttachBtn && statusAttachBtn.addEventListener('click', (e) => {
    e.preventDefault();
    statusFileInput.click();
  });
  statusFileInput && statusFileInput.addEventListener('change', () => {
    pendingStatusFile = (statusFileInput.files && statusFileInput.files[0]) || null;
  });

  postStatusBtn && postStatusBtn.addEventListener('click', () => {
    const text = statusTextInput.value.trim();
    const hasFile = !!pendingStatusFile;
    if (!text && !hasFile) return;

    const post = (fileMeta) => {
      socket.emit('story:add', { text, fileUrl: fileMeta && fileMeta.url, fileType: fileMeta && fileMeta.type }, (res) => {
        if (res && res.error) alert(res.error);
        statusTextInput.value = '';
        pendingStatusFile = null;
        if (statusFileInput) statusFileInput.value = '';
        socket.emit('story:list', (r) => {
          statuses = (r && r.stories) || [];
          renderStatuses();
        });
      });
    };

    if (hasFile) {
      const fd = new FormData();
      fd.append('file', pendingStatusFile);
      fetch('/api/upload', { method: 'POST', body: fd })
        .then((r) => r.json())
        .then((d) => {
          if (d && d.error) return alert(d.error);
          post({ url: d.fileUrl, type: d.fileType });
        })
        .catch(() => alert('Upload failed'));
    } else {
      post(null);
    }
  });

  socket.on('story:new', (story) => {
    statuses = [story, ...(statuses || [])];
    renderStatuses();
  });

  socket.on('message:reactions', (payload) => {
    const { messageId, reactions } = payload || {};
    if (!messageId) return;
    const entry = messageIndex.get(messageId);
    if (entry) {
      entry.message.reactions = reactions || [];
    }
    renderReactionsFor(messageId, reactions || []);
  });

  socket.on('system_message', (message) => {
    renderSystemMessage(message.text, message.timestamp);
  });

  socket.on('online_users', (users) => {
    updateUsersList(users || []);
  });

  // Call signaling handlers
  socket.on('call:incoming', (payload) => {
    const { from, mode, offer } = payload || {};
    if (!from || !offer) return;

    if (callState.active || incomingOffer) {
      socket.emit('call:answer', { to: from, accepted: false });
      return;
    }

    incomingOffer = { from, mode: mode === 'video' ? 'video' : 'voice', offer };
    showIncomingCall(from, incomingOffer.mode);
  });

  socket.on('call:answered', async (payload) => {
    const { from, answer } = payload || {};
    if (!from || !answer) return;
    if (!pc) return;

    try {
      await pc.setRemoteDescription(answer);
      callTitle.textContent = `In call with ${from}`;
      callSubtitle.textContent = callState.mode === 'video' ? 'Video call' : 'Voice call';
    } catch (_) {}
  });

  socket.on('call:ice', async (payload) => {
    const { candidate } = payload || {};
    if (!candidate || !pc) return;
    try {
      await pc.addIceCandidate(candidate);
    } catch (_) {}
  });

  socket.on('call:ended', (payload) => {
    const { reason, from } = payload || {};
    const wasActive = callState.active;
    cleanupCall();
    if (wasActive && reason === 'rejected') {
      alert(`${from || 'User'} rejected the call.`);
    }
  });

  socket.on('typing', (payload) => {
    const { user: fromUser, to, isTyping: isUserTyping } = payload || {};
    if (!fromUser || fromUser === username) return;

    if (to && to !== 'all' && to !== username) return;

    if (isUserTyping) {
      typingIndicator.textContent = `${fromUser} is typing...`;
    } else if (typingIndicator.textContent.startsWith(fromUser)) {
      typingIndicator.textContent = '';
    }
  });

  socket.on('error_message', (msg) => {
    alert(msg || 'An error occurred.');
  });
})();

