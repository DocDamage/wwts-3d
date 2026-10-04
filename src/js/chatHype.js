/**
 * Live chat hype: reads Twitch chat (anonymously, read-only) or YouTube Live
 * chat (with your own API key) and turns it into crowd energy on stage.
 *
 *  - Message rate lifts the stage crowd; hype words / emotes (🔥, W, fire,
 *    sheesh, heat, PogChamp…) count extra and can set off a cheer
 *  - "1" / "2" (or a contestant's name) counts as a chat vote
 *  - The latest messages feed the panel and the chat overlay
 */

const HYPE_RE = /🔥|💯|😤|🤯|\bW\b|\bfire\b|\bheat\b|\bsheesh+\b|\bgas\b|\bcrazy\b|\binsane\b|\bpog(champ|gers)?\b|\bhype\b|\bkreygasm\b|\bgoat\b/i;
const SETTINGS_KEY = 'wwts_chat_settings_v1';

class ChatHype {
  constructor({ onHype, getNames, toast }) {
    this.onHype = onHype || (() => {});
    this.getNames = getNames || (() => ['', '']);
    this.toast = toast || (() => {});
    this.recent = [];       // { user, text, platform, at }
    this.votes = [0, 0];
    this.voters = new Map(); // user -> 1|2 (one vote each, latest counts)
    this.window = [];       // timestamps of recent messages (rate)
    this.status = { twitch: 'off', youtube: 'off' };
    this.settings = this.loadSettings();
  }

  loadSettings() {
    try { return { hype: true, votes: true, twitch: '', ytVideo: '', ytKey: '', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { hype: true, votes: true }; }
  }

  saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* storage blocked */ }
  }

  /* ---------------- incoming messages ---------------- */

  message(platform, user, text) {
    const now = Date.now();
    this.recent.push({ platform, user, text: String(text).slice(0, 200), at: now });
    if (this.recent.length > 60) this.recent.shift();
    this.window.push(now);
    this.window = this.window.filter(t => now - t < 10000);
    if (this.settings.hype) {
      const hot = HYPE_RE.test(text);
      // a busy chat keeps the crowd up; hype words hit harder
      this.onHype(hot ? 0.09 : 0.02 + Math.min(0.04, this.window.length * 0.002));
    }
    if (this.settings.votes) {
      const t = String(text).trim().toLowerCase();
      const [n1, n2] = this.getNames().map(n => String(n || '').toLowerCase());
      let v = 0;
      if (/^1\b/.test(t) || (n1 && n1.length > 2 && t.includes(n1))) v = 1;
      else if (/^2\b/.test(t) || (n2 && n2.length > 2 && t.includes(n2))) v = 2;
      if (v) {
        const prev = this.voters.get(user);
        if (prev !== v) {
          if (prev) this.votes[prev - 1]--;
          this.votes[v - 1]++;
          this.voters.set(user, v);
        }
      }
    }
    this.render?.();
  }

  resetVotes() {
    this.votes = [0, 0];
    this.voters.clear();
    this.render?.();
  }

  rate() {
    const now = Date.now();
    return this.window.filter(t => now - t < 10000).length * 6;   // messages per minute
  }

  /* ---------------- Twitch (anonymous IRC over WebSocket) ---------------- */

  connectTwitch(channel) {
    this.disconnectTwitch();
    const ch = String(channel || '').trim().replace(/^#/, '').toLowerCase();
    if (!/^[a-z0-9_]{3,25}$/.test(ch)) { this.toast('Enter a Twitch channel name'); return; }
    this.settings.twitch = ch;
    this.saveSettings();
    const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    this.twitch = ws;
    this.status.twitch = 'connecting';
    ws.onopen = () => {
      ws.send('CAP REQ :twitch.tv/tags');
      ws.send('PASS SCHMOOPIIE');
      ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
      ws.send(`JOIN #${ch}`);
    };
    ws.onmessage = (e) => {
      String(e.data).split('\r\n').forEach(line => {
        if (!line) return;
        if (line.startsWith('PING')) { ws.send(line.replace('PING', 'PONG')); return; }
        if (/ 366 /.test(line) || / JOIN #/.test(line)) { this.status.twitch = 'live'; this.render?.(); }
        const m = line.match(/^(?:@([^ ]+) )?:([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.*)$/);
        if (!m) return;
        const tags = Object.fromEntries((m[1] || '').split(';').map(kv => kv.split('=')));
        this.message('twitch', tags['display-name'] || m[2], m[3]);
      });
    };
    ws.onclose = () => {
      if (this.twitch !== ws) return;
      this.status.twitch = 'off';
      this.render?.();
      // reconnect if it dropped on its own
      if (!this._twitchStopped) setTimeout(() => { if (this.twitch === ws) this.connectTwitch(ch); }, 4000);
    };
    this._twitchStopped = false;
    this.render?.();
  }

  disconnectTwitch() {
    this._twitchStopped = true;
    const ws = this.twitch;
    this.twitch = null;
    try { ws?.close(); } catch { /* already closed */ }
    this.status.twitch = 'off';
    this.render?.();
  }

  /* ---------------- YouTube Live (Data API, your key) ---------------- */

  async connectYouTube(video, key) {
    this.disconnectYouTube();
    const id = String(video || '').trim().match(/(?:v=|youtu\.be\/|live\/)?([A-Za-z0-9_-]{11})/)?.[1];
    if (!id || !key) { this.toast('Enter the live video link/ID and your YouTube API key'); return; }
    this.settings.ytVideo = id;
    this.settings.ytKey = key;
    this.saveSettings();
    this.status.youtube = 'connecting';
    this.render?.();
    try {
      const v = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${id}&key=${encodeURIComponent(key)}`)).json();
      const chatId = v.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
      if (!chatId) throw new Error(v.error?.message || 'That video has no live chat right now');
      this.ytActive = true;
      let page = '';
      const poll = async () => {
        if (!this.ytActive) return;
        try {
          const r = await (await fetch(`https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${chatId}&part=snippet,authorDetails&key=${encodeURIComponent(key)}${page ? `&pageToken=${page}` : ''}`)).json();
          if (r.error) throw new Error(r.error.message);
          const first = !page;
          page = r.nextPageToken || page;
          if (!first) (r.items || []).forEach(it => this.message('youtube', it.authorDetails?.displayName || 'viewer', it.snippet?.displayMessage || ''));
          this.status.youtube = 'live';
          this.render?.();
          this._ytTimer = setTimeout(poll, Math.max(3000, r.pollingIntervalMillis || 5000));
        } catch (e) {
          this.status.youtube = 'error';
          this.toast(`YouTube chat: ${e.message}`);
          this.render?.();
        }
      };
      poll();
    } catch (e) {
      this.status.youtube = 'error';
      this.toast(`YouTube chat: ${e.message}`);
      this.render?.();
    }
  }

  disconnectYouTube() {
    this.ytActive = false;
    clearTimeout(this._ytTimer);
    this.status.youtube = 'off';
    this.render?.();
  }

  /** For the overlay feed */
  overlayState() {
    if (this.status.twitch !== 'live' && this.status.youtube !== 'live' && !this.recent.length) return null;
    return { recent: this.recent.slice(-6).map(m => ({ user: m.user, text: m.text, platform: m.platform })), votes: [...this.votes], rate: this.rate() };
  }
}

class ChatPanel {
  constructor(chat) {
    this.chat = chat;
    chat.render = () => this.render();
  }

  init() {
    this.modal = document.getElementById('chat-modal');
    if (!this.modal) return;
    const s = this.chat.settings;
    const $ = (id) => document.getElementById(id);
    $('chat-twitch').value = s.twitch || '';
    $('chat-yt-video').value = s.ytVideo || '';
    $('chat-yt-key').value = s.ytKey || '';
    $('chat-hype-on').checked = s.hype !== false;
    $('chat-votes-on').checked = s.votes !== false;
    $('chat-twitch-go').addEventListener('click', () => (this.chat.twitch ? this.chat.disconnectTwitch() : this.chat.connectTwitch($('chat-twitch').value)));
    $('chat-yt-go').addEventListener('click', () => (this.chat.ytActive ? this.chat.disconnectYouTube() : this.chat.connectYouTube($('chat-yt-video').value, $('chat-yt-key').value)));
    $('chat-hype-on').addEventListener('change', (e) => { s.hype = e.target.checked; this.chat.saveSettings(); });
    $('chat-votes-on').addEventListener('change', (e) => { s.votes = e.target.checked; this.chat.saveSettings(); });
    $('chat-votes-reset').addEventListener('click', () => this.chat.resetVotes());
    this.modal.addEventListener('tool-open', () => this.render());
    setInterval(() => this.render(), 2000);
  }

  render() {
    if (!this.modal || this.modal.style.display === 'none') return;
    const c = this.chat;
    const label = { off: 'Not connected', connecting: 'Connecting…', live: '● Live', error: 'Error' };
    document.getElementById('chat-twitch-status').textContent = label[c.status.twitch];
    document.getElementById('chat-yt-status').textContent = label[c.status.youtube];
    document.getElementById('chat-twitch-go').textContent = c.twitch ? 'Disconnect' : 'Connect';
    document.getElementById('chat-yt-go').textContent = c.ytActive ? 'Disconnect' : 'Connect';
    const names = c.getNames();
    document.getElementById('chat-vote-line').textContent = `${names[0]} ${c.votes[0]} – ${c.votes[1]} ${names[1]} · ${c.rate()} msgs/min`;
    const esc = (t) => String(t).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    document.getElementById('chat-feed').innerHTML = c.recent.slice(-25).reverse().map(m => `<li><b class="${m.platform}">${esc(m.user)}</b> ${esc(m.text)}</li>`).join('') || '<li class="profile-muted">Chat messages appear here.</li>';
  }
}

export { ChatHype, ChatPanel, HYPE_RE };
