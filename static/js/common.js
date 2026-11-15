// Shared helpers for Coach & Student views

export function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getTokenStorageKey(role = null) {
  const r = role || (location.pathname.includes('alumn') ? 'student' : 'coach');
  return r === 'student' ? 'crossfit_student_token' : 'crossfit_coach_token';
}

export function getAuthToken(role = null) {
  return localStorage.getItem(getTokenStorageKey(role)) || '';
}

export function setAuthToken(token, role = null) {
  localStorage.setItem(getTokenStorageKey(role), token);
}

export function clearAuthToken(role = null) {
  localStorage.removeItem(getTokenStorageKey(role));
}

export async function api(url, options = {}) {
  const token = options.token !== undefined ? options.token : getAuthToken(options.role || null);
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }
  const opts = {
    cache: 'no-store',
    ...options,
    headers,
  };
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

export function getYoutubeEmbedUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace('/', '').trim();
      return id ? `https://www.youtube.com/embed/${id}?autoplay=1` : null;
    }
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname.startsWith('/embed/')) return url;
      if (u.pathname.startsWith('/shorts/')) {
        const id = u.pathname.split('/')[2];
        return id ? `https://www.youtube.com/embed/${id}?autoplay=1` : null;
      }
      const v = u.searchParams.get('v');
      return v ? `https://www.youtube.com/embed/${v}?autoplay=1` : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function openVideoModal(title, url, description = '') {
  const backdrop = document.getElementById('videoModal');
  const titleEl = document.getElementById('videoModalTitle');
  const container = document.getElementById('videoContainer');
  const descEl = document.getElementById('videoDescription');
  const extLink = document.getElementById('videoExternalLink');
  const searchLink = document.getElementById('videoSearchLink');
  if (!backdrop || !container) return;

  titleEl.textContent = title || 'Vídeo explicativo';
  const embed = getYoutubeEmbedUrl(url);
  if (embed) {
    container.innerHTML = `<iframe class="video-frame" src="${esc(embed)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  } else if (url) {
    container.innerHTML = `<div class="item-box"><p class="muted">Este enlace no es un vídeo embebible de YouTube. Puedes abrirlo directamente:</p><a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noopener">Abrir vídeo externo</a></div>`;
  } else {
    container.innerHTML = `<p class="muted">No hay vídeo asignado para este ejercicio todavía.</p>`;
  }
  if (descEl) {
    const cleanDesc = (description || '').trim();
    if (cleanDesc) {
      descEl.textContent = cleanDesc;
      descEl.classList.remove('hidden');
    } else {
      descEl.textContent = '';
      descEl.classList.add('hidden');
    }
  }
  if (extLink) {
    if (url) {
      extLink.href = url;
      extLink.classList.remove('hidden');
    } else {
      extLink.classList.add('hidden');
    }
  }
  if (searchLink) {
    const q = encodeURIComponent((title || 'crossfit exercise').replace(/\(GROUND\)/gi, '').trim() + ' crossfit tutorial');
    searchLink.href = `https://www.youtube.com/results?search_query=${q}`;
  }
  backdrop.classList.add('open');
}

export function closeVideoModal() {
  const backdrop = document.getElementById('videoModal');
  const container = document.getElementById('videoContainer');
  const descEl = document.getElementById('videoDescription');
  if (backdrop) backdrop.classList.remove('open');
  if (container) container.innerHTML = '';
  if (descEl) {
    descEl.textContent = '';
    descEl.classList.add('hidden');
  }
}

export function registerPwa() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

export function getDefaultMondayIso(baseDateStr = '') {
  let d = new Date();
  if (baseDateStr && /^\d{4}-\d{2}-\d{2}/.test(baseDateStr)) {
    const [y, m, day] = baseDateStr.slice(0, 10).split('-').map(Number);
    d = new Date(y, m - 1, day);
  }
  const dayOfWeek = d.getDay(); // 0=Sun..6=Sat
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  d.setDate(d.getDate() + diffToMonday);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatWeekLabel(mc, weekNumber) {
  const baseStr = (mc?.start_date || '').trim() || getDefaultMondayIso(mc?.created_at || '');
  const parts = baseStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    return `MICROCICLO ${weekNumber}`;
  }
  const start = new Date(parts[0], parts[1] - 1, parts[2]);
  start.setDate(start.getDate() + (Number(weekNumber) - 1) * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fmt = (dt) => `${dt.getDate()} de ${months[dt.getMonth()]}`;
  return `MICROCICLO ${weekNumber} (del ${fmt(start)} al ${fmt(end)})`;
}

export function formatMesocycleOption(mc) {
  if (!mc) return '';
  const w = mc.weeks_count || 4;
  const d = mc.days_per_week || 5;
  return `${mc.name} (${w} sem · ${d} días/sem)`;
}

export function formatWeekDateRange(mc, weekNumber) {
  const baseStr = (mc?.start_date || '').trim() || getDefaultMondayIso(mc?.created_at || '');
  const parts = baseStr.split('-').map(Number);
  if (parts.length === 3 && !parts.some(isNaN)) {
    const start = new Date(parts[0], parts[1] - 1, parts[2]);
    start.setDate(start.getDate() + (Number(weekNumber || 1) - 1) * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const pad = (n) => String(n).padStart(2, '0');
    return `SEMANA del ${pad(start.getDate())}/${pad(start.getMonth() + 1)} al ${pad(end.getDate())}/${pad(end.getMonth() + 1)}`;
  }
  return `SEMANA ${weekNumber || 1}`;
}

export function cleanMesocycleTitle(mc) {
  if (!mc) return 'MESOCICLO 1';
  const rawName = (mc.name || '').trim();
  const goal = (mc.primary_goal || '').trim();
  let title = '';

  if (/^mesociclo\s+\d+/i.test(rawName)) {
    title = rawName;
  } else if (/^mesociclo/i.test(rawName)) {
    title = `${rawName} ${mc.id || 1}`;
  } else {
    title = `MESOCICLO ${mc.id || 1}${rawName ? ': ' + rawName : ''}`;
  }

  if (goal && !title.toLowerCase().includes(goal.toLowerCase())) {
    title += ` (${goal})`;
  }
  return title;
}
