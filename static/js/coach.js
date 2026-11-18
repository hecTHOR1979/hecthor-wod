import { esc, api, showToast, openVideoModal, closeVideoModal, registerPwa, getAuthToken, setAuthToken, clearAuthToken, getDefaultMondayIso, formatWeekLabel } from './common.js';

registerPwa();

const EQUIPMENT_LIST = [
  'Barra olímpica', 'Discos', 'Mancuernas', 'Kettlebells',
  'Barra de dominadas', 'Cajón', 'Remo', 'EcoBike',
  'Balón medicinal', 'Wall Ball', 'Sled', 'Rope', 'Ski Erg', 'Bike Erg', 'Yoke', 'Farmers',
  'Anillas', 'Comba / Cuerda', 'Sin material'
];

const DEFAULT_SKILLS = [
  'Double Unders',
  'Pull-ups',
  'Chest-to-Bar',
  'Bar Muscle-ups',
  'Ring Muscle-ups',
  'Toes-to-Bar',
  'Handstand Push-ups (HSPU)',
  'Handstand Walk',
  'Pistols',
  'Rope Climbs',
  'Snatch',
  'Clean & Jerk',
  'Thrusters',
  'Overhead Squats',
  'Wall Balls',
  'Box Jump Overs',
  'Dumbbell Snatch',
  'Burpees over Bar'
];

const state = {
  coachConfigured: true,
  students: [],
  microcycles: [],
  currentMicrocycle: null,
  selectedWeek: 1,
  currentDay: null,
  exercises: [],
  warmupTypes: [],
  selectedEquipment: new Set(['Barra olímpica', 'Discos', 'Cajón', 'Sin material']),
  selectedSkills: new Set(),
  pickerTarget: null, // { type: 'warmup' } | { type: 'part', partIdx: number } | { type: 'wod' }
  pickerGroundOnly: false,
  qrMode: 'student',
  serverInfo: null,
};

const $ = (id) => document.getElementById(id);

let autoSaveTimer = null;
let isSaving = false;
let pendingSave = false;

function openModal(id) {
  $(id)?.classList.add('open');
}
function closeModal(id) {
  $(id)?.classList.remove('open');
}

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
$('btnCloseVideo').addEventListener('click', closeVideoModal);
$('btnCloseVideoBottom').addEventListener('click', closeVideoModal);
$('videoModal').addEventListener('click', (e) => {
  if (e.target.id === 'videoModal') closeVideoModal();
});

// Tabs
document.querySelectorAll('[data-tab]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (state.currentDay && pendingSave) {
      await doAutoSave();
    }
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.remove('active-tab'));
    btn.classList.add('active-tab');
    ['planner', 'library', 'students', 'logs'].forEach((t) => {
      $(`tab-${t}`).classList.toggle('hidden', t !== btn.dataset.tab);
    });
    if (btn.dataset.tab === 'library') renderLibrary();
    if (btn.dataset.tab === 'students') loadStudents();
    if (btn.dataset.tab === 'logs') loadLogs();
  });
});

// ================= COACH AUTHENTICATION =================
function showCoachLoginScreen(status) {
  state.coachConfigured = Boolean(status.coach_configured);
  $('coachAppContent').classList.add('hidden');
  $('coachNavPills').classList.add('hidden');
  $('coachAuthSection').classList.remove('hidden');
  $('coachAuthError').textContent = '';

  if (status.coach_username) {
    $('coachAuthUser').value = status.coach_username;
  }

  if (!state.coachConfigured) {
    $('coachAuthBadge').textContent = 'PRIMER ARRANQUE · CONFIGURACIÓN SEGURA';
    $('coachAuthTitle').textContent = 'Crea tu contraseña privada de Entrenador';
    $('coachAuthDesc').textContent = 'Nadie podrá entrar al panel de edición ni aprobar alumnos sin esta contraseña.';
    $('coachAuthConfirmWrap').classList.remove('hidden');
    $('btnCoachAuthSubmit').textContent = 'Guardar clave y Entrar';
  } else {
    $('coachAuthBadge').textContent = 'ACCESO PRIVADO DEL ENTRENADOR';
    $('coachAuthTitle').textContent = 'Iniciar sesión';
    $('coachAuthDesc').textContent = 'Introduce tu contraseña privada para gestionar entrenamientos y aprobar alumnos.';
    $('coachAuthConfirmWrap').classList.add('hidden');
    $('btnCoachAuthSubmit').textContent = 'Entrar al Panel';
  }
}

async function submitCoachAuth() {
  const username = $('coachAuthUser').value.trim() || 'coach';
  const password = $('coachAuthPass').value;
  $('coachAuthError').textContent = '';

  if (!password || password.length < 4) {
    $('coachAuthError').textContent = 'La contraseña debe tener al menos 4 caracteres.';
    return;
  }

  if (!state.coachConfigured) {
    const confirmPw = $('coachAuthPassConfirm').value;
    if (password !== confirmPw) {
      $('coachAuthError').textContent = 'Las contraseñas no coinciden.';
      return;
    }
  }

  try {
    const endpoint = state.coachConfigured ? '/api/auth/coach/login' : '/api/auth/coach/setup';
    const res = await api(endpoint, {
      method: 'POST',
      token: '',
      body: JSON.stringify({ username, password }),
    });
    setAuthToken(res.token, 'coach');
    $('coachAuthPass').value = '';
    $('coachAuthPassConfirm').value = '';
    $('coachAuthSection').classList.add('hidden');
    $('coachNavPills').classList.remove('hidden');
    $('coachAppContent').classList.remove('hidden');
    await init();
  } catch (err) {
    $('coachAuthError').textContent = err.message;
  }
}

$('btnCoachAuthSubmit').addEventListener('click', submitCoachAuth);
$('coachAuthPass').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && state.coachConfigured) submitCoachAuth();
});
$('coachAuthPassConfirm').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitCoachAuth();
});

$('btnCoachLogout').addEventListener('click', async () => {
  clearAuthToken('coach');
  const status = await api('/api/auth/status', { token: '' }).catch(() => ({ coach_configured: true }));
  showCoachLoginScreen(status);
});

$('btnCoachChangePw').addEventListener('click', () => {
  $('curCoachPw').value = '';
  $('newCoachPw').value = '';
  openModal('coachPwModal');
});

$('btnSaveCoachPw').addEventListener('click', async () => {
  const current_password = $('curCoachPw').value;
  const new_password = $('newCoachPw').value;
  if (!current_password || new_password.length < 4) {
    return showToast('Introduce tu clave actual y la nueva (mín. 4 caracteres)');
  }
  try {
    const res = await api('/api/auth/coach/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password }),
    });
    if (res.token) setAuthToken(res.token, 'coach');
    closeModal('coachPwModal');
    showToast('Contraseña actualizada');
  } catch (err) {
    showToast(err.message);
  }
});

// Init
async function checkAuthAndBoot() {
  try {
    const status = await api('/api/auth/status');
    if (status.actor?.role === 'coach') {
      $('coachAuthSection').classList.add('hidden');
      $('coachNavPills').classList.remove('hidden');
      $('coachAppContent').classList.remove('hidden');
      await init();
    } else {
      clearAuthToken('coach');
      showCoachLoginScreen(status);
    }
  } catch {
    showCoachLoginScreen({ coach_configured: true, coach_username: 'coach' });
  }
}

async function init() {
  loadCustomGoals();
  loadCustomWodTypes();
  loadCustomWodGoals();
  renderEquipmentChips();
  renderSkillsChips();
  await Promise.all([loadExercises(), loadWarmupTypes(), loadMicrocycles(), loadServerInfo(), loadStudents()]);
}

async function loadWarmupTypes(selectedName = null) {
  try {
    state.warmupTypes = await api('/api/warmup-types');
  } catch {
    state.warmupTypes = [
      { id: 1, name: 'Movilidad GROUND' },
      { id: 2, name: 'Calentamiento General' },
    ];
  }
  renderWarmupTypeSelect(selectedName);
}

function renderWarmupTypeSelect(selectedName = null) {
  const sel = $('warmupTypeSelect');
  if (!sel) return;
  const current = selectedName || sel.value || state.currentDay?.warmup_type || 'Movilidad GROUND';
  sel.innerHTML = '';
  const names = state.warmupTypes.map((t) => t.name);
  if (current && !names.includes(current) && current !== '__new__') names.push(current);
  names.forEach((n) => {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    sel.appendChild(opt);
  });
  const addOpt = document.createElement('option');
  addOpt.value = '__new__';
  addOpt.textContent = '+ Añadir nuevo tipo...';
  sel.appendChild(addOpt);

  sel.value = current;
  $('warmupTypeHeaderBadge').textContent = current === '__new__' ? 'Movilidad' : current;
}

$('warmupTypeSelect').addEventListener('change', (e) => {
  if (e.target.value === '__new__') {
    $('newWarmupTypeBox').classList.remove('hidden');
    $('newWarmupTypeInput').focus();
    return;
  }
  $('newWarmupTypeBox').classList.add('hidden');
  $('warmupTypeHeaderBadge').textContent = e.target.value;
  if (state.currentDay) state.currentDay.warmup_type = e.target.value;
});

$('btnToggleNewWarmupType').addEventListener('click', () => {
  $('newWarmupTypeBox').classList.toggle('hidden');
  if (!$('newWarmupTypeBox').classList.contains('hidden')) {
    $('newWarmupTypeInput').focus();
  }
});

$('newWarmupTypeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('btnSaveWarmupType').click();
  }
});

$('btnSaveWarmupType').addEventListener('click', async () => {
  const name = $('newWarmupTypeInput').value.trim();
  if (!name) return showToast('Escribe el nombre del tipo de Warm Up');
  try {
    await api('/api/warmup-types', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    $('newWarmupTypeInput').value = '';
    $('newWarmupTypeBox').classList.add('hidden');
    await loadWarmupTypes(name);
    if (state.currentDay) state.currentDay.warmup_type = name;
    showToast(`Tipo "${name}" añadido`);
  } catch (err) {
    showToast(err.message);
  }
});

async function loadServerInfo() {
  try {
    state.serverInfo = await api('/api/server-info');
  } catch {
    state.serverInfo = { coach_url: location.origin + '/', student_url: location.origin + '/alumnos' };
  }
}

async function loadExercises() {
  state.exercises = await api('/api/exercises');
  populateExercisesDatalist();
}

function populateExercisesDatalist() {
  const dl = $('libraryExercisesDatalist');
  if (!dl) return;
  dl.innerHTML = '';
  const seen = new Set();
  (state.exercises || []).forEach((ex) => {
    if (!ex.name) return;
    const namesToAdd = [ex.name.trim()];

    // Extraer nombre principal antes de paréntesis
    const mainMatch = ex.name.match(/^([^\(\/]+)/);
    if (mainMatch && mainMatch[1].trim().length >= 3) {
      namesToAdd.push(mainMatch[1].trim());
    }

    // Extraer alias dentro de paréntesis (ej: Back Squat (Sentadilla Trasera) o BMU)
    const aliasMatches = ex.name.matchAll(/\(([^)]+)\)/g);
    for (const m of aliasMatches) {
      const alias = m[1].trim();
      if (alias.length >= 2) {
        namesToAdd.push(alias);
        alias.split('/').forEach((subA) => {
          if (subA.trim().length >= 3) namesToAdd.push(subA.trim());
        });
      }
    }

    namesToAdd.forEach((n) => {
      const key = n.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        const opt = document.createElement('option');
        opt.value = n;
        if (n !== ex.name && ex.name) {
          opt.label = `${ex.name}`;
        } else if (ex.category) {
          opt.label = `${ex.category}`;
        }
        dl.appendChild(opt);
      }
    });
  });
}

function findLibraryExercise(searchStr) {
  if (!searchStr) return null;
  const raw = searchStr.trim().toLowerCase();
  if (!raw) return null;

  const normalize = (s) => (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const normTarget = normalize(raw);
  if (!normTarget) return null;

  const list = state.exercises || [];

  // 1. Coincidencia exacta cruda
  let match = list.find((ex) => (ex.name || '').trim().toLowerCase() === raw);
  if (match) return match;

  // 2. Coincidencia normalizada completa
  match = list.find((ex) => normalize(ex.name) === normTarget);
  if (match) return match;

  // 3. Coincidencia con nombre principal o alias entre paréntesis/barras
  for (const ex of list) {
    const exName = ex.name || '';
    const normFull = normalize(exName);

    const parts = exName.split(/[\(\)\/]/).map((p) => normalize(p)).filter(Boolean);
    for (const part of parts) {
      if (part === normTarget) return ex;
    }

    if (normFull.split(' ').includes(normTarget)) {
      return ex;
    }
  }

  // 4. Coincidencia por prefijo / inclusión (>= 4 caracteres)
  if (normTarget.length >= 4) {
    for (const ex of list) {
      const normFull = normalize(ex.name);
      if (normFull.startsWith(normTarget) || normTarget.startsWith(normFull)) {
        return ex;
      }
    }
  }

  return null;
}

function tryAutoLinkExercise(itemOrEx, rowEl, fieldName = 'video_url') {
  if (!itemOrEx || !itemOrEx.name) return false;
  const match = findLibraryExercise(itemOrEx.name);
  if (match) {
    let updated = false;
    if (match.video_url && itemOrEx.video_url !== match.video_url) {
      itemOrEx.video_url = match.video_url;
      const vInp = rowEl.querySelector(`
        [data-wu-field="${fieldName}"],
        [data-ex-f="${fieldName}"],
        [data-sub-wu-f="${fieldName}"],
        [data-sub-part-f="${fieldName}"],
        [data-timed-sub-wu-f="${fieldName}"],
        [data-timed-sub-part-f="${fieldName}"]
      `);
      if (vInp) vInp.value = match.video_url;

      const playBtn = rowEl.querySelector(`
        [data-play],
        [data-play-ex],
        [data-play-sub-wu],
        [data-play-sub-part],
        [data-play-timed-sub-wu],
        [data-play-timed-sub-part]
      `);
      if (playBtn) {
        playBtn.className = 'btn btn-sm btn-primary';
        playBtn.title = 'Ver vídeo explicativo';
      }
      updated = true;
    }
    if ((match.notes || match.coaching_cues) && (!itemOrEx.notes || itemOrEx.notes.trim() === '')) {
      itemOrEx.notes = match.notes || match.coaching_cues || '';
      const nInp = rowEl.querySelector(`
        [data-wu-field="notes"],
        [data-ex-f="notes"],
        [data-sub-wu-f="notes"],
        [data-sub-part-f="notes"],
        [data-timed-sub-wu-f="notes"],
        [data-timed-sub-part-f="notes"]
      `);
      if (nInp) nInp.value = itemOrEx.notes;
      updated = true;
    }
    if (updated) {
      showToast(`🎬 Vídeo vinculado de biblioteca: "${match.name}"`);
      triggerAutoSave(true);
    }
    return true;
  }
  return false;
}

async function autoSyncExerciseToLibrary(name, video_url, notes = '', category = 'Fuerza') {
  const cleanName = (name || '').trim();
  const cleanVideo = (video_url || '').trim();
  if (!cleanName || !cleanVideo) return;

  const existing = findLibraryExercise(cleanName);
  try {
    if (existing) {
      if (existing.video_url !== cleanVideo) {
        await api(`/api/exercises/${existing.id}`, {
          method: 'PUT',
          body: JSON.stringify({ video_url: cleanVideo, coaching_cues: notes || existing.coaching_cues }),
        });
        existing.video_url = cleanVideo;
        if (notes) existing.coaching_cues = notes;
        console.log(`✓ Vídeo actualizado en biblioteca para: ${existing.name}`);
      }
    } else {
      const created = await api('/api/exercises', {
        method: 'POST',
        body: JSON.stringify({
          name: cleanName,
          category: category || 'Fuerza',
          equipment: [],
          description: '',
          coaching_cues: notes || '',
          video_url: cleanVideo,
          is_ground: cleanName.toUpperCase().includes('GROUND') ? 1 : 0,
          ground_flow_level: 'N/A',
        }),
      });
      state.exercises.push({
        id: created.id || Date.now(),
        name: cleanName,
        category: category || 'Fuerza',
        video_url: cleanVideo,
        coaching_cues: notes || '',
        is_ground: cleanName.toUpperCase().includes('GROUND') ? 1 : 0,
      });
      populateExercisesDatalist();
      showToast(`💾 "${cleanName}" guardado en biblioteca con su vídeo`);
    }
  } catch (err) {
    console.warn('autoSyncExerciseToLibrary error:', err);
  }
}

async function loadMicrocycles(selectId = null) {
  state.microcycles = await api('/api/microcycles');
  
  // Respaldo de seguridad y auto-recuperación ante reinicios o despliegues
  if (!state.microcycles || state.microcycles.length === 0) {
    const rawBackup = localStorage.getItem('hecthor_crossfit_coach_backup');
    if (rawBackup) {
      try {
        const snap = JSON.parse(rawBackup);
        if (snap && snap.microcycles && snap.microcycles.length > 0) {
          console.warn('⚡ Base de datos vacía en el servidor. Restaurando copia de seguridad local del navegador...');
          await api('/api/backup/import', {
            method: 'POST',
            body: JSON.stringify({
              microcycles: snap.microcycles,
              days: snap.currentMicrocycle?.days || [],
            }),
          });
          state.microcycles = await api('/api/microcycles');
          showToast('✓ Sesión y mesociclos restaurados automáticamente desde copia local');
        }
      } catch (e) {
        console.error('Error al restaurar copia local:', e);
      }
    }
  }

  const sel = $('microcycleSelect');
  sel.innerHTML = '';
  if (!state.microcycles || state.microcycles.length === 0) {
    sel.innerHTML = '<option value="">Sin mesociclos (crea uno nuevo)</option>';
    state.currentMicrocycle = null;
    $('microcycleMeta').innerHTML = '';
    if ($('coachWeekSelect')) $('coachWeekSelect').innerHTML = '';
    $('daysGrid').innerHTML = '<p class="muted">Pulsa "+ Nuevo Mesociclo" para empezar.</p>';
    $('dayEditorCard').classList.add('hidden');
    return;
  }
  state.microcycles.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `${m.name} (${m.weeks_count || 4} sem · ${m.days_per_week || 5} días/sem · Código: ${m.access_code})`;
    sel.appendChild(opt);
  });
  
  // Memoria del mesociclo activo para no reiniciar nunca al [0] tras refrescar o volver de alumnos
  const savedMcId = Number(localStorage.getItem('hecthor_active_mc_id'));
  const mcExists = state.microcycles.some((m) => m.id === savedMcId);
  const targetId = selectId || (mcExists ? savedMcId : state.microcycles[0].id);
  sel.value = String(targetId);
  await selectMicrocycle(targetId);
}

$('microcycleSelect').addEventListener('change', async (e) => {
  if (state.currentDay && pendingSave) {
    await doAutoSave();
  }
  if (e.target.value) {
    const id = Number(e.target.value);
    localStorage.setItem('hecthor_active_mc_id', String(id));
    selectMicrocycle(id);
  }
});

async function selectMicrocycle(id) {
  localStorage.setItem('hecthor_active_mc_id', String(id));
  const mc = await api(`/api/microcycles/${id}`);
  state.currentMicrocycle = mc;
  
  const savedWeek = Number(localStorage.getItem(`hecthor_active_week_${id}`)) || 1;
  state.selectedWeek = (savedWeek >= 1 && savedWeek <= mc.weeks_count) ? savedWeek : 1;
  
  renderMicrocycleMeta();
  renderWeekSelect();
  renderDaysGrid();
  
  if (mc.days && mc.days.length > 0) {
    const savedDayId = Number(localStorage.getItem(`hecthor_active_day_${id}`));
    const weekDays = mc.days.filter((d) => d.week_number === state.selectedWeek);
    const targetDay = weekDays.find((d) => d.id === savedDayId) || weekDays[0] || mc.days[0];
    openDayEditor(targetDay.id);
  } else {
    $('dayEditorCard').classList.add('hidden');
  }
  saveLocalStateSnapshot();
}

function renderMicrocycleMeta() {
  const mc = state.currentMicrocycle;
  if (!mc) return;
  const startVal = (mc.start_date || '').trim() || getDefaultMondayIso(mc.created_at || '');

  const standardGoals = [
    'Fuerza & Halterofilia',
    'Fuerza',
    'Fondo / Engine',
    'Movilidad & GROUND',
    'Halterofilia',
    'Gimnásticos & Metcon',
    'Híbrido Completo',
  ];
  if (mc.primary_goal && !standardGoals.includes(mc.primary_goal)) {
    standardGoals.unshift(mc.primary_goal);
  }

  $('microcycleMeta').innerHTML = `
    <div class="row-wrap" style="gap:8px; align-items:center; flex-wrap:wrap;">
      <div class="row-wrap" style="gap:6px; align-items:center; background:rgba(2,132,199,0.12); border:1.2px solid #0284c7; border-radius:6px; padding:3px 8px;">
        <label for="editMcGoalSelect" style="font-size:0.8rem; font-weight:800; color:#38bdf8; text-transform:uppercase; margin:0;">🎯 Objetivo:</label>
        <select id="editMcGoalSelect" class="input" style="width:auto; padding:3px 6px; font-size:0.85rem; font-weight:800; color:#38bdf8; background:#0c121e; border:none; cursor:pointer;" title="Modificar el objetivo del mesociclo">
          ${standardGoals.map((g) => `<option value="${esc(g)}" ${g === mc.primary_goal ? 'selected' : ''}>${esc(g)}</option>`).join('')}
          <option value="__custom__">✏️ Escribir otro objetivo...</option>
        </select>
      </div>
      <span class="badge">${mc.weeks_count} Semanas · ${mc.days_per_week} días/sem</span>
      <span class="badge badge-blue">Código: <strong>${esc(mc.access_code)}</strong></span>
      <label class="row-wrap" style="gap:6px; font-size:0.82rem; color:var(--text-muted); align-items:center;">
        Inicio Sem. 1:
        <input id="editMcStartDate" type="date" class="input" style="width:auto; padding:3px 8px; font-size:0.82rem;" value="${esc(startVal)}" />
      </label>
      ${mc.description ? `<span class="muted" style="font-size:0.85rem;">${esc(mc.description)}</span>` : ''}
    </div>
  `;

  $('editMcGoalSelect')?.addEventListener('change', async (e) => {
    let nextGoal = e.target.value;
    if (nextGoal === '__custom__') {
      const custom = window.prompt('Introduce el nuevo objetivo para este mesociclo:', mc.primary_goal || '');
      if (!custom || !custom.trim()) {
        e.target.value = mc.primary_goal;
        return;
      }
      nextGoal = custom.trim();
    }
    try {
      await api(`/api/microcycles/${mc.id}`, {
        method: 'PUT',
        body: JSON.stringify({ primary_goal: nextGoal }),
      });
      mc.primary_goal = nextGoal;
      const found = state.microcycles.find((m) => m.id === mc.id);
      if (found) found.primary_goal = nextGoal;
      showToast(`🎯 Objetivo actualizado: ${nextGoal}`);
      renderMicrocycleMeta();
      saveLocalStateSnapshot();
    } catch (err) {
      showToast(err.message || 'Error al actualizar objetivo');
    }
  });

  $('editMcStartDate')?.addEventListener('change', async (e) => {
    const val = e.target.value;
    if (!val) return;
    try {
      await api(`/api/microcycles/${mc.id}`, {
        method: 'PUT',
        body: JSON.stringify({ start_date: val }),
      });
      mc.start_date = val;
      renderWeekSelect();
      if (state.currentDay) {
        $('editorDayBadge').textContent = `MICROCICLO ${state.currentDay.week_number} · Día ${state.currentDay.day_number}`;
      }
      showToast('Fecha de inicio actualizada');
    } catch (err) {
      showToast(err.message);
    }
  });
}

function renderWeekSelect() {
  const mc = state.currentMicrocycle;
  const sel = $('coachWeekSelect');
  if (!sel || !mc) return;
  sel.innerHTML = '';
  for (let w = 1; w <= mc.weeks_count; w++) {
    const opt = document.createElement('option');
    opt.value = w;
    opt.textContent = formatWeekLabel(mc, w);
    if (w === state.selectedWeek) opt.selected = true;
    sel.appendChild(opt);
  }
}

$('coachWeekSelect')?.addEventListener('change', async (e) => {
  if (state.currentDay && pendingSave) {
    await doAutoSave();
  }
  const w = Number(e.target.value);
  state.selectedWeek = w;
  if (state.currentMicrocycle) {
    localStorage.setItem(`hecthor_active_week_${state.currentMicrocycle.id}`, String(w));
    localStorage.setItem('hecthor_active_week', String(w));
  }
  renderDaysGrid();
  const weekDays = (state.currentMicrocycle?.days || []).filter((d) => d.week_number === state.selectedWeek);
  if (weekDays.length > 0) {
    openDayEditor(weekDays[0].id);
  }
});

function renderDaysGrid() {
  const mc = state.currentMicrocycle;
  const grid = $('daysGrid');
  grid.innerHTML = '';
  const weekDays = (mc.days || []).filter((d) => d.week_number === state.selectedWeek);

  weekDays.forEach((d) => {
    const hasGround = (d.warmup_exercises || []).some((x) =>
      (x.name || '').toLowerCase().includes('ground')
    );
    const card = document.createElement('div');
    card.className = `day-card ${state.currentDay && state.currentDay.id === d.id ? 'selected' : ''}`;
    card.innerHTML = `
      <div class="row-between">
        <span class="badge">Día ${d.day_number}</span>
        ${hasGround ? '<span class="badge badge-ground">GROUND</span>' : ''}
      </div>
      <div style="font-weight:800;">${esc(d.title)}</div>
      <div class="muted">Warm Up: ${(d.warmup_exercises || []).length} mov · Bloques: ${(d.parts || []).length}</div>
      <div class="badge badge-orange" style="align-self:flex-start;">
        ${esc(d.wod?.type || 'WOD')}: ${esc(d.wod?.title || 'Sin definir')}
      </div>
    `;
    card.addEventListener('click', () => openDayEditor(d.id));
    grid.appendChild(card);
  });
}

async function openDayEditor(dayId) {
  if (state.currentDay && pendingSave && state.currentDay.id !== dayId) {
    await doAutoSave();
  }
  const mc = state.currentMicrocycle;
  if (mc) {
    localStorage.setItem(`hecthor_active_day_${mc.id}`, String(dayId));
    localStorage.setItem('hecthor_active_day_id', String(dayId));
  }
  const day = (mc?.days || []).find((d) => d.id === dayId);
  if (!day) return;
  
  let effectiveDay = JSON.parse(JSON.stringify(day));
  try {
    const rawDraft = localStorage.getItem(`hecthor_draft_day_${dayId}`);
    if (rawDraft) {
      const draft = JSON.parse(rawDraft);
      if (draft && draft.payload) {
        effectiveDay = { ...effectiveDay, ...draft.payload };
      }
    }
  } catch {}
  
  state.currentDay = effectiveDay;
  $('dayEditorCard').classList.remove('hidden');
  $('editorDayBadge').textContent = `MICROCICLO ${effectiveDay.week_number} · Día ${effectiveDay.day_number}`;
  $('dayTitle').value = effectiveDay.title || '';
  $('dayCoachingTips').value = effectiveDay.coaching_tips || '';
  renderWarmupTypeSelect(effectiveDay.warmup_type || 'Movilidad GROUND');
  $('warmupNotes').value = effectiveDay.warmup_notes || '';
  const wt = effectiveDay.warmup_timer || { type: 'AMRAP', minutes: 8 };
  $('warmupTimerType').value = wt.type || 'AMRAP';
  $('warmupTimerMinutes').value = wt.minutes || 8;
  if ($('warmupTabataWork')) $('warmupTabataWork').value = wt.tabata_work !== undefined ? wt.tabata_work : 20;
  if ($('warmupTabataRest')) $('warmupTabataRest').value = wt.tabata_rest !== undefined ? wt.tabata_rest : 10;
  if ($('warmupTabataRounds')) $('warmupTabataRounds').value = wt.tabata_rounds !== undefined ? wt.tabata_rounds : 8;
  if ($('warmupEmomInterval')) $('warmupEmomInterval').value = wt.emom_interval !== undefined ? wt.emom_interval : 60;
  if ($('warmupEmomRounds')) $('warmupEmomRounds').value = wt.emom_rounds !== undefined ? wt.emom_rounds : 8;
  updateWarmupTimerUI();

  // Copy target dropdown - format strictly as S2/D2
  const copySel = $('copyTargetDay');
  copySel.innerHTML = '';
  mc.days.forEach((other) => {
    if (other.id !== day.id) {
      const opt = document.createElement('option');
      opt.value = other.id;
      opt.textContent = `S${other.week_number}/D${other.day_number}`;
      opt.title = `Semana ${other.week_number} - Día ${other.day_number}: ${other.title || 'Sin título'}`;
      copySel.appendChild(opt);
    }
  });

  // WOD
  if (!state.currentDay.wod) state.currentDay.wod = {};
  if (!Array.isArray(state.currentDay.wod.exercises)) {
    if (Array.isArray(state.currentDay.wod.movements) && state.currentDay.wod.movements.length > 0) {
      state.currentDay.wod.exercises = state.currentDay.wod.movements.map((m) => ({
        sets: m.sets || '',
        reps: m.reps || '',
        name: m.name || '',
        video_url: m.video_url || '',
        notes: m.notes || '',
        sub_exercises: Array.isArray(m.sub_exercises) ? m.sub_exercises : [],
        is_timed_section: Boolean(m.is_timed_section),
        is_sub_block: Boolean(m.is_sub_block),
        timer_type: m.timer_type || 'AMRAP',
        timer_minutes: m.timer_minutes || 10,
        tabata_work: m.tabata_work,
        tabata_rest: m.tabata_rest,
        tabata_rounds: m.tabata_rounds,
        emom_interval: m.emom_interval,
        emom_rounds: m.emom_rounds,
      }));
    } else {
      state.currentDay.wod.exercises = [];
    }
  }
  if (!Array.isArray(state.currentDay.wod.movements)) state.currentDay.wod.movements = state.currentDay.wod.exercises;
  const wod = state.currentDay.wod;
  $('wodTitle').value = wod.title || '';
  $('wodType').value = wod.type || 'AMRAP';
  const hasCap = wod.has_time_cap !== undefined ? Boolean(wod.has_time_cap) : Boolean(wod.time_cap && wod.time_cap.trim() !== '');
  if ($('wodHasTimeCap')) {
    $('wodHasTimeCap').checked = hasCap;
  }
  if ($('wodTimeCap')) {
    $('wodTimeCap').value = hasCap ? (wod.time_cap || '') : '';
    $('wodTimeCap').disabled = !hasCap;
    delete $('wodTimeCap').dataset.manualEdited;
  }
  $('wodTarget').value = wod.target_score || '';
  $('wodDescription').value = wod.description || '';
  $('wodRx').value = wod.rx_weights || '';
  $('wodScaled').value = wod.scaled_weights || '';
  $('wodStrategy').value = wod.strategy || '';

  if ($('wodTabataWork')) $('wodTabataWork').value = wod.tabata_work || 20;
  if ($('wodTabataRest')) $('wodTabataRest').value = wod.tabata_rest !== undefined ? wod.tabata_rest : 10;
  if ($('wodTabataRounds')) $('wodTabataRounds').value = wod.tabata_rounds || 8;
  if ($('wodEmomInterval')) $('wodEmomInterval').value = wod.emom_interval || 60;
  if ($('wodEmomRounds')) $('wodEmomRounds').value = wod.emom_rounds || 10;
  if ($('wodMinutes')) $('wodMinutes').value = wod.minutes || 12;
  if ($('wodHasScore')) {
    const hasScore = wod.has_score !== undefined ? Boolean(wod.has_score) : true;
    $('wodHasScore').checked = hasScore;
    $('wodScoreConfigWrap')?.classList.toggle('hidden', !hasScore);
  }
  if ($('wodScoreType')) {
    const rawType = (wod.type || '').toUpperCase();
    const defaultScore = rawType.includes('TIME') ? 'TIEMPO' : (rawType.includes('AMRAP') ? 'RONDAS + REPS' : (rawType.includes('EMOM') ? 'REPS' : 'REPS'));
    $('wodScoreType').value = wod.score_type || defaultScore;
    delete $('wodScoreType').dataset.manualEdited;
  }
  updateWodTimerUI();

  // Ocultar recuadro de recomendación del generador al cambiar de día
  $('wodGenRecommendationBox')?.classList.add('hidden');
  state.lastGeneratedWodRecommendation = null;

  renderWarmupList();
  renderPartsList();
  renderWodExercisesList();
  renderDaysGrid();
}

async function saveExerciseToLibrary({ name, video_url = '', notes = '', category = 'Fuerza', is_ground = 0, ground_flow_level = 'N/A' }) {
  const cleanName = (name || '').trim();
  if (!cleanName) {
    showToast('El ejercicio debe tener un nombre');
    return false;
  }
  const cleanVideo = (video_url || '').trim();
  const cleanNotes = (notes || '').trim();
  const existing = state.exercises.find((item) => (item.name || '').toLowerCase() === cleanName.toLowerCase());
  try {
    if (existing) {
      await api(`/api/exercises/${existing.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          video_url: cleanVideo,
          coaching_cues: cleanNotes || existing.coaching_cues,
        }),
      });
      existing.video_url = cleanVideo;
      if (cleanNotes) existing.coaching_cues = cleanNotes;
      showToast(`Vídeo de "${cleanName}" actualizado en la biblioteca.`);
    } else {
      const created = await api('/api/exercises', {
        method: 'POST',
        body: JSON.stringify({
          name: cleanName,
          category: category || 'Fuerza',
          equipment: [],
          description: '',
          coaching_cues: cleanNotes,
          video_url: cleanVideo,
          is_ground: is_ground,
          ground_flow_level: ground_flow_level || 'N/A',
        }),
      });
      state.exercises.push(created);
      showToast(`"${cleanName}" guardado en la biblioteca.`);
    }
    await loadExercises();
    renderLibrary();
    return true;
  } catch (err) {
    showToast('Error al guardar en biblioteca: ' + err.message);
    return false;
  }
}

export function createTimedSectionItem(timer_type = 'AMRAP', minutes = 10) {
  const normType = ['AMRAP', 'EMOM', 'TABATA', 'FOR TIME'].includes(timer_type) ? timer_type : 'AMRAP';
  let defaultMin = Number(minutes) || 10;
  if (normType === 'TABATA') defaultMin = 4;
  return {
    is_timed_section: true,
    timer_type: normType,
    name: `${normType} (${defaultMin} min)`,
    timer_minutes: defaultMin,
    emom_interval: 60,
    emom_rounds: 10,
    tabata_work: 20,
    tabata_rest: 10,
    tabata_rounds: 8,
    notes: '',
    sub_exercises: []
  };
}

export function createSubBlockItem(name = '') {
  return {
    is_sub_block: true,
    name,
    notes: '',
    sub_exercises: []
  };
}

/**
 * Renderiza un cuadro / sub-bloque numerado en el editor del coach (Warmup, Bloque o WOD).
 */
function renderSubBlockCoachBox(item, boxOrderNum, cfg) {
  const row = document.createElement('div');
  row.className = 'sub-block-coach-box';
  const subs = Array.isArray(item.sub_exercises) ? item.sub_exercises : [];
  const hasLoad = Boolean(cfg.showLoad);

  const subExercisesHtml = subs.map((sub, sIdx) => `
    <div class="sub-ex-coach-row" style="margin-top:6px; padding-top:6px; border-top:1px dashed rgba(16,185,129,0.25); display:flex; flex-direction:column; gap:4px;">
      <div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; width:100%;">
        <div style="width:${hasLoad ? '65px' : '75px'}; flex-shrink:0;">
          <input class="input" style="padding:6px; font-size:0.85rem;" data-sb-sub-f="sets" data-sub-idx="${sIdx}" placeholder="SETS" value="${esc(sub.sets || '')}" />
        </div>
        <div style="width:${hasLoad ? '75px' : '85px'}; flex-shrink:0;">
          <input class="input" style="padding:6px; font-size:0.85rem;" data-sb-sub-f="reps" data-sub-idx="${sIdx}" placeholder="REPS" value="${esc(sub.reps || '')}" />
        </div>
        ${hasLoad ? `
          <div style="width:80px; flex-shrink:0;">
            <input class="input" style="padding:6px; font-size:0.85rem;" data-sb-sub-f="load" data-sub-idx="${sIdx}" placeholder="CARGA" value="${esc(sub.load || '')}" />
          </div>
          <div style="width:65px; flex-shrink:0;"></div>
        ` : ''}
        <div style="flex:1; min-width:130px;">
          <input class="input" style="padding:6px; font-size:0.88rem; font-weight:700;" data-sb-sub-f="name" data-sub-idx="${sIdx}" list="libraryExercisesDatalist" placeholder="MOVE (ejercicio...)" value="${esc(sub.name || '')}" autocomplete="off" />
        </div>
        <div style="flex:1.2; min-width:150px; display:flex; align-items:center; gap:4px;">
          <input class="input" style="padding:6px; font-size:0.82rem; flex:1;" data-sb-sub-f="video_url" data-sub-idx="${sIdx}" placeholder="VIDEO (URL vídeo...)" value="${esc(sub.video_url || '')}" />
          <button class="btn btn-sm ${sub.video_url ? 'btn-primary' : 'btn-outline'}" type="button" data-sb-play-sub="${sIdx}" title="Ver o buscar vídeo" style="padding:5px 8px; font-size:0.95rem;">🎬</button>
        </div>
        <div class="row-wrap" style="width:130px; justify-content:flex-end; gap:4px; flex-shrink:0;">
          <button class="btn btn-sm btn-outline" type="button" data-sb-search-sub="${sIdx}" title="Buscar en biblioteca" style="padding:6px 8px;">🔍</button>
          <button class="btn btn-danger btn-sm" type="button" data-sb-del-sub="${sIdx}" title="Quitar este ejercicio" style="padding:6px 8px;">✕</button>
        </div>
      </div>
      <div>
        <input class="input" style="padding:3px 6px; font-size:0.8rem; color:var(--text-muted); background:transparent; border:none; border-bottom:1px dashed rgba(255,255,255,0.08);" data-sb-sub-f="notes" data-sub-idx="${sIdx}" placeholder="Notas o detalles..." value="${esc(sub.notes || '')}" />
      </div>
    </div>
  `).join('');

  row.innerHTML = `
    <div class="row-between" style="align-items:center; margin-bottom:8px; gap:8px; flex-wrap:wrap;">
      <span class="badge" style="background:#10b981; color:#06281e; font-weight:900; font-size:0.82rem; padding:4px 8px;">📦 ${boxOrderNum}.- CUADRO / SUB-BLOQUE</span>
      <button class="btn btn-danger btn-sm" type="button" data-sb-del-box title="Eliminar este cuadro">✕</button>
    </div>
    <div style="margin-bottom:6px;">
      <label style="font-size:0.75rem; color:#10b981; font-weight:700;">Título del cuadro (ej: Carrera, RM de Clean, 85% de 1.-...)</label>
      <input class="input" style="padding:6px; font-size:0.9rem; font-weight:700;" data-sb-field="name" value="${esc(item.name || '')}" placeholder="Ej: Carrera / RM de Clean / 85% de 1.-..." />
    </div>
    <div style="margin-bottom:6px;">
      <input class="input" style="padding:4px 6px; font-size:0.82rem;" data-sb-field="notes" value="${esc(item.notes || '')}" placeholder="Indicaciones o notas de este cuadro..." />
    </div>
    <div style="margin-top:8px; border-top:1px dashed rgba(16,185,129,0.3); padding-top:6px;">
      <div class="row-between" style="align-items:center; margin-bottom:4px;">
        <span style="font-size:0.75rem; font-weight:800; color:#10b981; text-transform:uppercase;">Ejercicios de este cuadro</span>
        <div class="row-wrap" style="gap:4px;">
          <button class="btn btn-sm btn-primary" type="button" data-sb-add-sub style="font-size:0.78rem; padding:3px 8px;">+ Añadir ejercicio</button>
          <button class="btn btn-sm btn-outline" type="button" data-sb-add-lib style="font-size:0.78rem; padding:3px 8px;">📚 Biblioteca</button>
        </div>
      </div>
      ${subs.length > 0 ? `
        <div style="display:flex; align-items:center; gap:6px; padding:2px 8px; font-size:0.72rem; font-weight:800; color:#10b981; text-transform:uppercase; margin-bottom:2px;">
          <div style="width:${hasLoad ? '65px' : '75px'}; text-align:center;">SETS</div>
          <div style="width:${hasLoad ? '75px' : '85px'}; text-align:center;">REPS</div>
          ${hasLoad ? '<div style="width:80px; text-align:center;">CARGA</div><div style="width:65px;"></div>' : ''}
          <div style="flex:1; min-width:130px;">MOVE</div>
          <div style="flex:1.2; min-width:150px;">VIDEO</div>
          <div style="width:130px; text-align:right;">ACCIONES</div>
        </div>
      ` : ''}
      ${subExercisesHtml}
    </div>
  `;

  row.querySelector('[data-sb-del-box]')?.addEventListener('click', cfg.onDelete);
  row.querySelectorAll('[data-sb-field]').forEach((inp) => {
    inp.addEventListener('input', () => {
      item[inp.dataset.sbField] = inp.value;
      triggerAutoSave(false);
    });
    inp.addEventListener('change', () => {
      item[inp.dataset.sbField] = inp.value;
      triggerAutoSave(true);
    });
  });
  row.querySelector('[data-sb-add-sub]')?.addEventListener('click', cfg.onAddSub);
  row.querySelector('[data-sb-add-lib]')?.addEventListener('click', cfg.onAddSubLib);
  row.querySelectorAll('[data-sb-del-sub]').forEach((btn) => {
    btn.addEventListener('click', () => cfg.onDelSub(Number(btn.dataset.sbDelSub)));
  });
  row.querySelectorAll('[data-sb-search-sub]').forEach((btn) => {
    btn.addEventListener('click', () => cfg.onSearchSub(Number(btn.dataset.sbSearchSub)));
  });
  row.querySelectorAll('[data-sb-play-sub]').forEach((btn) => {
    btn.addEventListener('click', () => cfg.onPlaySub(Number(btn.dataset.sbPlaySub)));
  });
  row.querySelectorAll('[data-sb-sub-f]').forEach((inp) => {
    const sIdx = Number(inp.dataset.subIdx);
    const handleSub = (immediate) => {
      const subObj = item.sub_exercises[sIdx];
      if (!subObj) return;
      subObj[inp.dataset.sbSubF] = inp.value;
      if (inp.dataset.sbSubF === 'name') {
        const subRowEl = inp.closest('.sub-ex-coach-row');
        if (subRowEl) tryAutoLinkExercise(subObj, subRowEl, 'video_url');
      }
      triggerAutoSave(immediate);
    };
    inp.addEventListener('input', () => handleSub(false));
    inp.addEventListener('change', () => handleSub(true));
    inp.addEventListener('blur', () => {
      if (inp.dataset.sbSubF === 'name') {
        const subRowEl = inp.closest('.sub-ex-coach-row');
        if (subRowEl && item.sub_exercises[sIdx]) {
          tryAutoLinkExercise(item.sub_exercises[sIdx], subRowEl, 'video_url');
        }
      }
    });
  });
  return row;
}

function renderWarmupList() {
  const list = $('warmupList');
  const items = state.currentDay.warmup_exercises || [];
  if (items.length === 0) {
    list.innerHTML = '<p class="muted" style="margin:8px 0;">Sin ejercicios añadidos en Warm Up. Pulsa "+ Añadir ejercicio" o "📚 Biblioteca".</p>';
    return;
  }
  list.innerHTML = '';

  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex; align-items:center; gap:6px; padding:4px 10px; font-size:0.75rem; font-weight:800; color:#38bdf8; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;';
  hdr.innerHTML = `
    <div style="width:75px; text-align:center;">SETS</div>
    <div style="width:85px; text-align:center;">REPS</div>
    <div style="flex:1; min-width:140px;">MOVE</div>
    <div style="flex:1.2; min-width:160px;">VIDEO</div>
    <div style="width:160px; text-align:right;">ACCIONES</div>
  `;
  list.appendChild(hdr);

  let wuBoxNum = 0;

  items.forEach((item, idx) => {
    if (!Array.isArray(item.sub_exercises)) item.sub_exercises = [];

    // SECCIÓN CON CRONÓMETRO EN CALENTAMIENTO (AMRAP, EMOM, TABATA, FOR TIME)
    if (item.is_timed_section) {
      wuBoxNum += 1;
      const row = document.createElement('div');
      row.className = 'timed-section-coach-box';
      const curTimer = (item.timer_type || 'AMRAP').toUpperCase();
      const normTimer = ['AMRAP', 'EMOM', 'TABATA', 'FOR TIME'].includes(curTimer) ? curTimer : 'AMRAP';

      let subExercisesHtml = '';
      (item.sub_exercises || []).forEach((sub, sIdx) => {
        subExercisesHtml += `
          <div class="sub-ex-coach-row" style="margin-top:6px; padding-top:6px; border-top:1px dashed rgba(56,189,248,0.25); display:flex; flex-direction:column; gap:4px;">
            <div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; width:100%;">
              <div style="width:75px; flex-shrink:0;">
                <input class="input" style="padding:6px; font-size:0.85rem;" data-timed-sub-wu-f="sets" data-sub-idx="${sIdx}" placeholder="SETS" value="${esc(sub.sets || '')}" title="Series o rondas (opcional)" />
              </div>
              <div style="width:85px; flex-shrink:0;">
                <input class="input" style="padding:6px; font-size:0.85rem;" data-timed-sub-wu-f="reps" data-sub-idx="${sIdx}" placeholder="REPS" value="${esc(sub.reps || '')}" title="Repeticiones o Tiempo (ej: 10 / 30s)" />
              </div>
              <div style="flex:1; min-width:140px;">
                <input class="input" style="padding:6px; font-size:0.88rem; font-weight:700;" data-timed-sub-wu-f="name" data-sub-idx="${sIdx}" list="libraryExercisesDatalist" placeholder="MOVE (ejercicio...)" value="${esc(sub.name || '')}" autocomplete="off" />
              </div>
              <div style="flex:1.2; min-width:160px; display:flex; align-items:center; gap:4px;">
                <input class="input" style="padding:6px; font-size:0.82rem; flex:1;" data-timed-sub-wu-f="video_url" data-sub-idx="${sIdx}" placeholder="VIDEO (URL vídeo...)" value="${esc(sub.video_url || '')}" />
                <button class="btn btn-sm ${sub.video_url ? 'btn-primary' : 'btn-outline'}" type="button" data-play-timed-sub-wu="${sIdx}" title="${sub.video_url ? 'Ver vídeo explicativo' : 'Buscar vídeo'}" style="padding:5px 8px; font-size:0.95rem;">🎬</button>
              </div>
              <div class="row-wrap" style="width:130px; justify-content:flex-end; gap:4px; flex-shrink:0;">
                <button class="btn btn-sm btn-outline" type="button" data-search-timed-sub-wu="${sIdx}" title="Buscar en biblioteca" style="padding:6px 8px;">🔍</button>
                <button class="btn btn-danger btn-sm" type="button" data-del-timed-sub-wu="${sIdx}" title="Quitar este ejercicio" style="padding:6px 8px;">✕</button>
              </div>
            </div>
            <div>
              <input class="input" style="padding:3px 6px; font-size:0.8rem; color:var(--text-muted); background:transparent; border:none; border-bottom:1px dashed rgba(255,255,255,0.08);" data-timed-sub-wu-f="notes" data-sub-idx="${sIdx}" placeholder="Notas o detalles..." value="${esc(sub.notes || '')}" />
            </div>
          </div>
        `;
      });

      row.innerHTML = `
        <div class="row-between" style="align-items:center; margin-bottom:8px; gap:8px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="badge" style="background:#0284c7; color:#ffffff; font-weight:900; font-size:0.82rem; padding:4px 8px;">⏱ ${wuBoxNum}.- CRONO EN CALENTAMIENTO</span>
            <select class="input" style="padding:4px 8px; font-size:0.85rem; font-weight:800; width:auto; color:#38bdf8; background:#0c121e; border-color:#0284c7;" data-wu-timed-field="timer_type">
              ${['AMRAP', 'EMOM', 'TABATA', 'FOR TIME'].map((opt) => `<option value="${opt}" ${normTimer === opt ? 'selected' : ''}>${opt}</option>`).join('')}
            </select>
          </div>
          <div class="row-wrap" style="gap:6px;">
            <button class="btn btn-sm btn-outline" type="button" data-test-wu-timed="${idx}" title="Probar en Crono Pro" style="border-color:#38bdf8; color:#38bdf8; font-weight:800;">⚡ Probar Crono Pro</button>
            <button class="btn btn-danger btn-sm" type="button" data-del-wu="${idx}" title="Eliminar este bloque con crono">✕</button>
          </div>
        </div>

        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:6px;">
          <div style="flex:2; min-width:180px;">
            <label style="font-size:0.75rem; color:#38bdf8; font-weight:700;">Título / Formato visible</label>
            <input class="input" style="padding:6px; font-size:0.88rem; font-weight:700;" data-wu-timed-field="name" value="${esc(item.name || '')}" placeholder="Ej: AMRAP (10 min) / 500m Run + AMRAP..." />
          </div>
          <div style="flex:1; min-width:100px;">
            <label style="font-size:0.75rem; color:#38bdf8; font-weight:700;">Minutos / Cap</label>
            <input class="input" type="number" min="1" max="120" style="padding:6px; font-size:0.88rem;" data-wu-timed-field="timer_minutes" value="${esc(item.timer_minutes || 10)}" />
          </div>
        </div>

        ${normTimer === 'TABATA' ? `
          <div class="grid-3" style="background:rgba(0,0,0,0.25); border-radius:6px; padding:6px 8px; margin-bottom:6px;">
            <div><label style="font-size:0.75rem; color:#0284c7; font-weight:700;">Trabajo (s)</label><input class="input" type="number" min="5" max="300" step="5" data-wu-timed-field="tabata_work" value="${esc(item.tabata_work !== undefined ? item.tabata_work : 20)}" style="padding:4px;" /></div>
            <div><label style="font-size:0.75rem; color:#10b981; font-weight:700;">Descanso (s)</label><input class="input" type="number" min="0" max="300" step="5" data-wu-timed-field="tabata_rest" value="${esc(item.tabata_rest !== undefined ? item.tabata_rest : 10)}" style="padding:4px;" /></div>
            <div><label style="font-size:0.75rem; font-weight:700;">Rondas</label><input class="input" type="number" min="1" max="50" data-wu-timed-field="tabata_rounds" value="${esc(item.tabata_rounds !== undefined ? item.tabata_rounds : 8)}" style="padding:4px;" /></div>
          </div>
        ` : ''}

        ${normTimer === 'EMOM' ? `
          <div class="grid-2" style="background:rgba(0,0,0,0.25); border-radius:6px; padding:6px 8px; margin-bottom:6px;">
            <div><label style="font-size:0.75rem; color:#0284c7; font-weight:700;">Cada (s)</label><input class="input" type="number" min="10" max="300" step="10" data-wu-timed-field="emom_interval" value="${esc(item.emom_interval !== undefined ? item.emom_interval : 60)}" style="padding:4px;" /></div>
            <div><label style="font-size:0.75rem; font-weight:700;">Rondas</label><input class="input" type="number" min="1" max="60" data-wu-timed-field="emom_rounds" value="${esc(item.emom_rounds !== undefined ? item.emom_rounds : 10)}" style="padding:4px;" /></div>
          </div>
        ` : ''}

        <div style="margin-bottom:6px;">
          <input class="input" style="padding:4px 6px; font-size:0.82rem;" data-wu-timed-field="notes" value="${esc(item.notes || '')}" placeholder="Descripción o estrategia (ej: 10 Burpees + 15 KB Swings sin parar)..." />
        </div>

        <div style="margin-top:8px; border-top:1px dashed rgba(56,189,248,0.3); padding-top:6px;">
          <div class="row-between" style="align-items:center; margin-bottom:4px;">
            <span style="font-size:0.75rem; font-weight:800; color:#38bdf8; text-transform:uppercase;">Ejercicios de este ${normTimer}</span>
            <div class="row-wrap" style="gap:4px;">
              <button class="btn btn-sm btn-primary" type="button" data-add-sub-timed-wu="${idx}" style="font-size:0.78rem; padding:3px 8px;">+ Añadir ejercicio</button>
              <button class="btn btn-sm btn-outline" type="button" data-search-timed-sub-wu-any="${idx}" style="font-size:0.78rem; padding:3px 8px;">📚 Biblioteca</button>
            </div>
          </div>
          ${(item.sub_exercises || []).length > 0 ? `
            <div style="display:flex; align-items:center; gap:6px; padding:2px 8px; font-size:0.72rem; font-weight:800; color:#38bdf8; text-transform:uppercase; margin-bottom:2px;">
              <div style="width:75px; text-align:center;">SETS</div>
              <div style="width:85px; text-align:center;">REPS</div>
              <div style="flex:1; min-width:140px;">MOVE</div>
              <div style="flex:1.2; min-width:160px;">VIDEO</div>
              <div style="width:130px; text-align:right;">ACCIONES</div>
            </div>
          ` : ''}
          ${subExercisesHtml}
        </div>
      `;

      row.querySelector('[data-del-wu]').addEventListener('click', () => {
        state.currentDay.warmup_exercises.splice(idx, 1);
        renderWarmupList();
        triggerAutoSave(true);
      });

      row.querySelector(`[data-test-wu-timed="${idx}"]`)?.addEventListener('click', () => {
        const spec = {
          mode: normTimer,
          minutes: Number(item.timer_minutes) || 10,
          workSec: Number(item.tabata_work !== undefined ? item.tabata_work : 20),
          restSec: Number(item.tabata_rest !== undefined ? item.tabata_rest : 10),
          tabataRounds: Number(item.tabata_rounds !== undefined ? item.tabata_rounds : 8),
          intervalSec: Number(item.emom_interval !== undefined ? item.emom_interval : 60),
          rounds: Number(item.emom_rounds !== undefined ? item.emom_rounds : 10)
        };
        openCoachCronoProModal(spec);
      });

      row.querySelectorAll('[data-wu-timed-field]').forEach((inp) => {
        const handler = () => {
          const field = inp.dataset.wuTimedField;
          const val = inp.value;
          state.currentDay.warmup_exercises[idx][field] = val;
          if (field === 'timer_type') {
            const nextNorm = ['AMRAP', 'EMOM', 'TABATA', 'FOR TIME'].includes(val) ? val : 'AMRAP';
            if (nextNorm === 'TABATA') {
              if (item.tabata_work === undefined) item.tabata_work = 20;
              if (item.tabata_rest === undefined) item.tabata_rest = 10;
              if (item.tabata_rounds === undefined) item.tabata_rounds = 8;
              item.timer_minutes = Math.ceil(((Number(item.tabata_work) + Number(item.tabata_rest)) * Number(item.tabata_rounds)) / 60);
            } else if (nextNorm === 'EMOM') {
              if (item.emom_interval === undefined) item.emom_interval = 60;
              if (item.emom_rounds === undefined) item.emom_rounds = 10;
              item.timer_minutes = Math.round((Number(item.emom_interval) * Number(item.emom_rounds)) / 60);
            }
            if (!item.name || item.name.startsWith('AMRAP') || item.name.startsWith('EMOM') || item.name.startsWith('TABATA') || item.name.startsWith('FOR TIME')) {
              item.name = `${nextNorm} (${item.timer_minutes || 10} min)`;
            }
            renderWarmupList();
            triggerAutoSave(true);
          } else if (field === 'tabata_work' || field === 'tabata_rest' || field === 'tabata_rounds') {
            const w = Number(item.tabata_work !== undefined ? item.tabata_work : 20);
            const r = Number(item.tabata_rest !== undefined ? item.tabata_rest : 10);
            const rounds = Number(item.tabata_rounds !== undefined ? item.tabata_rounds : 8);
            item.timer_minutes = Math.ceil(((w + r) * rounds) / 60);
            triggerAutoSave(false);
          } else if (field === 'emom_interval' || field === 'emom_rounds') {
            const intSec = Number(item.emom_interval !== undefined ? item.emom_interval : 60);
            const rounds = Number(item.emom_rounds !== undefined ? item.emom_rounds : 10);
            item.timer_minutes = Math.round((intSec * rounds) / 60);
            triggerAutoSave(false);
          } else {
            triggerAutoSave(false);
          }
        };
        inp.addEventListener('input', handler);
        inp.addEventListener('change', handler);
      });

      row.querySelector(`[data-add-sub-timed-wu="${idx}"]`)?.addEventListener('click', () => {
        if (!Array.isArray(state.currentDay.warmup_exercises[idx].sub_exercises)) {
          state.currentDay.warmup_exercises[idx].sub_exercises = [];
        }
        state.currentDay.warmup_exercises[idx].sub_exercises.push({
          sets: '',
          reps: '10',
          name: '',
          video_url: '',
          notes: ''
        });
        renderWarmupList();
        triggerAutoSave(true);
      });

      row.querySelector(`[data-search-timed-sub-wu-any="${idx}"]`)?.addEventListener('click', () => {
        openExercisePicker({ type: 'timed_wu_sub_add', idx }, false);
      });

      (item.sub_exercises || []).forEach((sub, sIdx) => {
        row.querySelector(`[data-del-timed-sub-wu="${sIdx}"]`)?.addEventListener('click', () => {
          state.currentDay.warmup_exercises[idx].sub_exercises.splice(sIdx, 1);
          renderWarmupList();
          triggerAutoSave(true);
        });

        row.querySelector(`[data-search-timed-sub-wu="${sIdx}"]`)?.addEventListener('click', () => {
          openExercisePicker({ type: 'timed_wu_sub_replace', idx, subIdx: sIdx }, false, sub.name);
        });

        row.querySelector(`[data-play-timed-sub-wu="${sIdx}"]`)?.addEventListener('click', () => {
          const curSub = state.currentDay.warmup_exercises[idx].sub_exercises[sIdx];
          if (curSub?.video_url) {
            openVideoModal(curSub.name, curSub.video_url);
          } else {
            openExercisePicker({ type: 'timed_wu_sub_replace', idx, subIdx: sIdx }, false, curSub.name);
          }
        });

        row.querySelectorAll(`[data-timed-sub-wu-f][data-sub-idx="${sIdx}"]`).forEach((inp) => {
          const handleTimedSubInput = (isImmediate) => {
            state.currentDay.warmup_exercises[idx].sub_exercises[sIdx][inp.dataset.timedSubWuF] = inp.value;
            if (inp.dataset.timedSubWuF === 'name') {
              const subRowEl = inp.closest('.sub-ex-coach-row');
              if (subRowEl) {
                tryAutoLinkExercise(state.currentDay.warmup_exercises[idx].sub_exercises[sIdx], subRowEl, 'video_url');
              }
            }
            triggerAutoSave(isImmediate);
          };
          inp.addEventListener('input', () => handleTimedSubInput(false));
          inp.addEventListener('change', () => handleTimedSubInput(true));
          inp.addEventListener('blur', () => {
            if (inp.dataset.timedSubWuF === 'name') {
              const subRowEl = inp.closest('.sub-ex-coach-row');
              if (subRowEl) {
                tryAutoLinkExercise(state.currentDay.warmup_exercises[idx].sub_exercises[sIdx], subRowEl, 'video_url');
              }
            }
          });
        });
      });

      list.appendChild(row);
      return;
    }

    if (item.is_sub_block) {
      wuBoxNum += 1;
      const row = renderSubBlockCoachBox(item, wuBoxNum, {
        showLoad: false,
        onDelete: () => {
          state.currentDay.warmup_exercises.splice(idx, 1);
          renderWarmupList();
          triggerAutoSave(true);
        },
        onAddSub: () => {
          item.sub_exercises.push({ sets: '', reps: '10', name: '', video_url: '', notes: '' });
          renderWarmupList();
          triggerAutoSave(true);
        },
        onAddSubLib: () => openExercisePicker({ type: 'timed_wu_sub_add', idx }, false),
        onDelSub: (sIdx) => {
          item.sub_exercises.splice(sIdx, 1);
          renderWarmupList();
          triggerAutoSave(true);
        },
        onSearchSub: (sIdx) => openExercisePicker({ type: 'timed_wu_sub_replace', idx, subIdx: sIdx }, false),
        onPlaySub: (sIdx) => {
          const curSub = item.sub_exercises[sIdx];
          if (curSub && curSub.video_url) openVideoPreviewModal(curSub.name || 'Ejercicio', curSub.video_url, curSub.notes || '');
          else openExercisePicker({ type: 'timed_wu_sub_replace', idx, subIdx: sIdx }, false);
        },
      });
      list.appendChild(row);
      return;
    }

    const hasSubs = item.sub_exercises.length > 0;
    const row = document.createElement('div');
    row.className = 'ex-coach-line';
    if (hasSubs) {
      row.style.borderLeft = '3px solid #38bdf8';
      row.style.background = 'rgba(56,189,248,0.03)';
      row.style.paddingLeft = '10px';
    }

    let subHtml = '';
    item.sub_exercises.forEach((sub, subIdx) => {
      subHtml += `
        <div class="sub-ex-coach-row" style="margin-top:8px; padding-top:6px; border-top:1px dashed rgba(56,189,248,0.25); display:flex; flex-direction:column; gap:4px;">
          <div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; width:100%;">
            <div style="width:75px; flex-shrink:0; display:flex; align-items:center; justify-content:center;">
              <span class="badge" style="background:rgba(56,189,248,0.2); color:#38bdf8; font-weight:800; font-size:0.75rem; padding:4px 8px; width:100%; text-align:center;">+ ${subIdx + 2}</span>
            </div>
            <div style="width:85px; flex-shrink:0;">
              <input class="input" style="padding:6px; font-size:0.85rem;" data-sub-wu-f="reps" data-sub-idx="${subIdx}" placeholder="REPS" value="${esc(sub.reps || '')}" title="Repeticiones o Tiempo (ej: 10 / 30s)" />
            </div>
            <div style="flex:1; min-width:140px;">
              <input class="input" style="padding:6px; font-size:0.88rem; font-weight:700;" data-sub-wu-f="name" data-sub-idx="${subIdx}" list="libraryExercisesDatalist" placeholder="MOVE (ejercicio...)" value="${esc(sub.name || '')}" autocomplete="off" />
            </div>
            <div style="flex:1.2; min-width:160px; display:flex; align-items:center; gap:4px;">
              <input class="input" style="padding:6px; font-size:0.82rem; flex:1;" data-sub-wu-f="video_url" data-sub-idx="${subIdx}" placeholder="VIDEO (URL vídeo...)" value="${esc(sub.video_url || '')}" />
              <button class="btn btn-sm ${sub.video_url ? 'btn-primary' : 'btn-outline'}" type="button" data-play-sub-wu="${subIdx}" title="${sub.video_url ? 'Ver vídeo explicativo' : 'Buscar vídeo'}" style="padding:5px 8px; font-size:0.95rem;">🎬</button>
            </div>
            <div class="row-wrap" style="width:160px; justify-content:flex-end; gap:4px; flex-shrink:0;">
              <button class="btn btn-sm btn-outline" type="button" data-add-sub-wu="${idx}" title="Añadir otro ejercicio dentro de este bloque (+)" style="padding:6px 9px; font-weight:800; color:#38bdf8; border-color:rgba(56,189,248,0.4); font-size:1rem;">+</button>
              <button class="btn btn-sm btn-outline" type="button" data-search-sub-wu="${subIdx}" title="Buscar en biblioteca" style="padding:6px 8px;">🔍</button>
              <button class="btn btn-danger btn-sm" type="button" data-del-sub-wu="${subIdx}" title="Quitar este ejercicio" style="padding:6px 8px;">✕</button>
            </div>
          </div>
          <div>
            <input class="input" style="padding:3px 6px; font-size:0.8rem; color:var(--text-muted); background:transparent; border:none; border-bottom:1px dashed rgba(255,255,255,0.08);" data-sub-wu-f="notes" data-sub-idx="${subIdx}" placeholder="Notas de este ejercicio..." value="${esc(sub.notes || '')}" />
          </div>
        </div>
      `;
    });

    row.innerHTML = `
      <div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; width:100%;">
        <div style="width:75px; flex-shrink:0;">
          ${hasSubs 
            ? `<div style="display:flex; align-items:center; gap:4px;"><span class="badge" style="background:rgba(56,189,248,0.2); color:#38bdf8; font-weight:800; font-size:0.75rem; padding:4px 6px;">1</span><input class="input" style="padding:6px; font-size:0.85rem; width:100%;" data-wu-field="sets" placeholder="SETS" value="${esc(item.sets || '')}" title="SETS (Rondas o Series)" /></div>`
            : `<input class="input" style="padding:6px; font-size:0.85rem; width:100%;" data-wu-field="sets" placeholder="SETS" value="${esc(item.sets || '')}" title="SETS (Rondas o Series)" />`
          }
        </div>
        <div style="width:85px; flex-shrink:0;">
          <input class="input" style="padding:6px; font-size:0.85rem;" data-wu-field="reps" placeholder="REPS" value="${esc(item.reps || '')}" title="REPS (Repeticiones o Tiempo)" />
        </div>
        <div style="flex:1; min-width:140px;">
          <input class="input" style="padding:6px; font-size:0.88rem; font-weight:700;" data-wu-field="name" list="libraryExercisesDatalist" placeholder="${idx + 1}.- MOVE (ejercicio...)" value="${esc(item.name || '')}" autocomplete="off" />
        </div>
        <div style="flex:1.2; min-width:160px; display:flex; align-items:center; gap:4px;">
          <input class="input" style="padding:6px; font-size:0.82rem; flex:1;" data-wu-field="video_url" placeholder="VIDEO (URL vídeo...)" value="${esc(item.video_url || '')}" />
          <button class="btn btn-sm ${item.video_url ? 'btn-primary' : 'btn-outline'}" type="button" data-play="${idx}" title="${item.video_url ? 'Ver vídeo explicativo' : 'Buscar vídeo'}" style="padding:5px 8px; font-size:0.95rem;">
            🎬
          </button>
        </div>
        <div class="row-wrap" style="width:160px; justify-content:flex-end; gap:4px; flex-shrink:0;">
          <button class="btn btn-sm btn-outline" type="button" data-add-timed-wu="${idx}" title="Añadir AMRAP, EMOM, TABATA o FOR TIME después de este ejercicio" style="padding:6px 8px; font-weight:800; color:#38bdf8; border-color:rgba(56,189,248,0.5);">⏱+</button>
          <button class="btn btn-sm btn-outline" type="button" data-add-sub-wu="${idx}" title="Añadir otro ejercicio dentro de este bloque (+)" style="padding:6px 9px; font-weight:800; color:#38bdf8; border-color:rgba(56,189,248,0.4); font-size:1rem;">
            +
          </button>
          <button class="btn btn-sm btn-outline" type="button" data-search-lib-wu="${idx}" title="Buscar este ejercicio en la biblioteca" style="padding:6px 8px;">🔍</button>
          <button class="btn btn-sm btn-outline" type="button" data-save-lib-wu title="Guardar en biblioteca" style="padding:6px 8px;">💾</button>
          <button class="btn btn-danger btn-sm" type="button" data-del-wu="${idx}" title="Eliminar ejercicio" style="padding:6px 8px;">✕</button>
        </div>
      </div>
      <div style="margin-top:4px;">
        <input class="input" style="padding:3px 6px; font-size:0.8rem; color:var(--text-muted); background:transparent; border:none; border-bottom:1px dashed rgba(255,255,255,0.1);" data-wu-field="notes" placeholder="Notas técnicas opcionales..." value="${esc(item.notes || '')}" />
      </div>
      ${subHtml}
    `;

    // Botón ⏱+ para añadir AMRAP/EMOM después de este ejercicio
    row.querySelector(`[data-add-timed-wu="${idx}"]`)?.addEventListener('click', () => {
      state.currentDay.warmup_exercises.splice(idx + 1, 0, createTimedSectionItem('AMRAP', 10));
      renderWarmupList();
      triggerAutoSave(true);
      showToast('⏱ AMRAP añadido después del ejercicio');
    });

    // Add sub-exercise to create superserie
    row.querySelectorAll(`[data-add-sub-wu="${idx}"]`).forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!Array.isArray(state.currentDay.warmup_exercises[idx].sub_exercises)) {
          state.currentDay.warmup_exercises[idx].sub_exercises = [];
        }
        state.currentDay.warmup_exercises[idx].sub_exercises.push({
          name: '',
          reps: '',
          video_url: '',
          notes: '',
        });
        renderWarmupList();
        triggerAutoSave(true);
      });
    });

    row.querySelector('[data-del-wu]').addEventListener('click', () => {
      state.currentDay.warmup_exercises.splice(idx, 1);
      renderWarmupList();
      triggerAutoSave(true);
    });

    row.querySelector(`[data-search-lib-wu="${idx}"]`)?.addEventListener('click', () => {
      openExercisePicker({ type: 'warmup_replace', idx }, false, item.name);
    });

    const playBtn = row.querySelector('[data-play]');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        const url = state.currentDay.warmup_exercises[idx].video_url;
        if (url) {
          openVideoModal(item.name, url);
        } else {
          openExercisePicker({ type: 'warmup_replace', idx }, false, item.name);
        }
      });
    }

    row.querySelector('[data-save-lib-wu]')?.addEventListener('click', async () => {
      const cur = state.currentDay.warmup_exercises[idx];
      const isG = (cur.name || '').includes('(GROUND)') ? 1 : 0;
      const ok = await saveExerciseToLibrary({
        name: cur.name,
        video_url: cur.video_url,
        notes: cur.notes,
        category: isG ? 'GROUND Flow' : 'Calentamiento',
        is_ground: isG,
      });
      if (ok) renderWarmupList();
    });

    row.querySelectorAll('[data-wu-field]').forEach((inp) => {
      const handleWuInput = (isImmediate) => {
        state.currentDay.warmup_exercises[idx][inp.dataset.wuField] = inp.value;
        if (inp.dataset.wuField === 'name') {
          tryAutoLinkExercise(state.currentDay.warmup_exercises[idx], row, 'video_url');
        }
        triggerAutoSave(isImmediate);
      };
      inp.addEventListener('input', () => handleWuInput(false));
      inp.addEventListener('change', () => handleWuInput(true));
      inp.addEventListener('blur', () => {
        if (inp.dataset.wuField === 'name') {
          tryAutoLinkExercise(state.currentDay.warmup_exercises[idx], row, 'video_url');
        }
      });
    });

    // Sub-exercises event binding
    item.sub_exercises.forEach((sub, subIdx) => {
      row.querySelector(`[data-del-sub-wu="${subIdx}"]`)?.addEventListener('click', () => {
        state.currentDay.warmup_exercises[idx].sub_exercises.splice(subIdx, 1);
        renderWarmupList();
        triggerAutoSave(true);
      });

      row.querySelector(`[data-search-sub-wu="${subIdx}"]`)?.addEventListener('click', () => {
        openExercisePicker({ type: 'warmup_sub_replace', idx, subIdx }, false, sub.name);
      });

      row.querySelector(`[data-play-sub-wu="${subIdx}"]`)?.addEventListener('click', () => {
        const curSub = state.currentDay.warmup_exercises[idx].sub_exercises[subIdx];
        if (curSub?.video_url) {
          openVideoModal(curSub.name, curSub.video_url);
        } else {
          openExercisePicker({ type: 'warmup_sub_replace', idx, subIdx }, false, curSub.name);
        }
      });

      row.querySelectorAll(`[data-sub-wu-f][data-sub-idx="${subIdx}"]`).forEach((inp) => {
        const handleSubInput = (isImmediate) => {
          state.currentDay.warmup_exercises[idx].sub_exercises[subIdx][inp.dataset.subWuF] = inp.value;
          if (inp.dataset.subWuF === 'name') {
            const subRowEl = inp.closest('.sub-ex-coach-row');
            if (subRowEl) {
              tryAutoLinkExercise(state.currentDay.warmup_exercises[idx].sub_exercises[subIdx], subRowEl, 'video_url');
            }
          }
          triggerAutoSave(isImmediate);
        };
        inp.addEventListener('input', () => handleSubInput(false));
        inp.addEventListener('change', () => handleSubInput(true));
        inp.addEventListener('blur', () => {
          if (inp.dataset.subWuF === 'name') {
            const subRowEl = inp.closest('.sub-ex-coach-row');
            if (subRowEl) {
              tryAutoLinkExercise(state.currentDay.warmup_exercises[idx].sub_exercises[subIdx], subRowEl, 'video_url');
            }
          }
        });
      });
    });

    list.appendChild(row);
  });
}

function renderPartsList() {
  const list = $('partsList');
  const parts = state.currentDay.parts || [];
  if (parts.length === 0) {
    list.innerHTML = '<p class="muted">Sin bloques añadidos (p. ej. BLOQUE 1: Fuerza, BLOQUE 2: Halterofilia). Pulsa "+ Añadir Bloque".</p>';
    return;
  }
  list.innerHTML = '';
  parts.forEach((part, pIdx) => {
    const box = document.createElement('div');
    box.className = 'item-box item-box-celeste';
    const blockLabel = `BLOQUE ${pIdx + 1}`;
    const curTimer = (part.timer_type || 'SIN CRONO').toUpperCase();
    const normalizedTimer = ['AMRAP', 'EMOM', 'TABATA', 'FOR TIME'].includes(curTimer) ? curTimer : (curTimer === 'EMON' ? 'EMOM' : 'SIN CRONO');

    box.innerHTML = `
      <div class="row-between" style="margin-bottom:8px;">
        <span class="badge badge-celeste-matte">${esc(blockLabel)}</span>
        <div class="row-wrap" style="gap:6px;">
          <button class="btn btn-primary btn-sm" type="button" data-add-part-line="${pIdx}">+ Añadir ejercicio</button>
          <button class="btn btn-sm btn-outline" type="button" data-add-part-subblock="${pIdx}" style="border-color:#10b981; color:#10b981; font-weight:800;" title="Añadir cuadro / sub-bloque numerado">📦 + Añadir cuadro</button>
          <button class="btn btn-sm btn-outline" type="button" data-add-part-timed="${pIdx}" style="border-color:#38bdf8; color:#38bdf8; font-weight:800;" title="Añadir bloque con crono (AMRAP, EMOM, TABATA, FOR TIME)">⏱ + Añadir bloque con crono</button>
          <button class="btn btn-sm btn-outline" type="button" data-add-ex="${pIdx}">📚 Biblioteca</button>
          <button class="btn btn-danger btn-sm" type="button" data-del-part="${pIdx}">Eliminar bloque</button>
        </div>
      </div>
      <div class="grid-2">
        <div class="field" style="margin-bottom:0;">
          <label>Título del bloque</label>
          <input class="input" data-part-field="title" placeholder="Título (ej: Fuerza Back Squat)" value="${esc(part.title || '')}" />
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>Tipo de ejercicio / trabajo</label>
          <input class="input" data-part-field="type" placeholder="Fuerza, Halterofilia, Gimnásticos..." value="${esc(part.type || '')}" />
        </div>
      </div>

      <div style="margin-top:8px; margin-bottom:8px; background:rgba(255,107,53,0.06); border:1px solid rgba(255,107,53,0.25); border-radius:6px; padding:6px 10px;">
        <label style="display:inline-flex; align-items:center; gap:8px; cursor:pointer; font-weight:700; color:var(--accent); font-size:0.88rem; margin:0;">
          <input type="checkbox" data-part-field="has_score" ${part.has_score ? 'checked' : ''} style="width:18px; height:18px; accent-color:var(--accent);" />
          🏆 Permitir a los alumnos registrar marca / resultado en este bloque
        </label>
      </div>

      <textarea class="input" style="margin-bottom:8px;" data-part-field="description" placeholder="Esquema general del bloque, %RM, descansos...">${esc(part.description || '')}</textarea>

      <!-- LÍNEAS DE EJERCICIOS DEL BLOQUE (FORMATO LÍNEAS CON VÍDEO A LA DERECHA) -->
      <div style="margin-bottom:12px;">
        <div class="row-between" style="margin-bottom:6px; align-items:center;">
          <span style="font-size:0.82rem; font-weight:800; color:#38bdf8; text-transform:uppercase;">📋 Ejercicios del bloque</span>
          <div class="row-wrap" style="gap:6px;">
            <button class="btn btn-sm btn-primary" type="button" data-add-part-line="${pIdx}">+ Añadir ejercicio</button>
            <button class="btn btn-sm btn-outline" type="button" data-add-part-subblock="${pIdx}" style="border-color:#10b981; color:#10b981; font-weight:800;" title="Añadir cuadro / sub-bloque numerado">📦 + Añadir cuadro</button>
            <button class="btn btn-sm btn-outline" type="button" data-add-part-timed="${pIdx}" style="border-color:#38bdf8; color:#38bdf8; font-weight:800;" title="Añadir bloque con crono (AMRAP, EMOM, TABATA, FOR TIME)">⏱ + Añadir bloque con crono</button>
            <button class="btn btn-sm btn-outline" type="button" data-add-ex="${pIdx}">📚 Biblioteca</button>
          </div>
        </div>
        <div data-part-ex-list="${pIdx}"></div>
      </div>

      <!-- CRONO DEL BLOQUE (OCULTO - SE UTILIZAN BLOQUES CON CRONO MODULARES) -->
      <div style="display:none;" aria-hidden="true">
        <div class="row-between" style="margin-bottom:8px; align-items:center;">
          <label style="color:#38bdf8; font-weight:800; font-size:0.85rem; margin:0;">⏱ Formato de crono del bloque (al final)</label>
          ${normalizedTimer !== 'SIN CRONO' ? `<button class="btn btn-sm btn-outline" type="button" data-launch-part-crono="${pIdx}" title="Probar en Crono Oficial">⚡ Crono Oficial ↗</button>` : ''}
        </div>
        <div class="grid-2">
          <div class="field" style="margin-bottom:0;">
            <select class="input" data-part-field="timer_type">
              ${['SIN CRONO', 'AMRAP', 'EMOM', 'TABATA', 'FOR TIME'].map((opt) => {
                return `<option value="${opt}" ${normalizedTimer === opt ? 'selected' : ''}>${opt === 'SIN CRONO' ? 'Sin crono (Fuerza / Técnica)' : opt}</option>`;
              }).join('')}
            </select>
          </div>
          <div class="field" style="margin-bottom:0;">
            <input class="input" type="number" min="1" max="60" data-part-field="timer_minutes" placeholder="Tiempo / Cap (min)" value="${esc(part.timer_minutes || 12)}" />
          </div>
        </div>
        ${normalizedTimer === 'TABATA' ? `
          <div class="grid-3" style="background:rgba(2,132,199,0.06); border:1px solid rgba(2,132,199,0.22); border-radius:6px; padding:8px 10px; margin-top:8px;">
            <div class="field" style="margin-bottom:0;">
              <label style="color:#0284c7; font-weight:700;">🔵 Trabajo (segundos)</label>
              <input class="input" type="number" min="5" max="300" step="5" data-part-field="tabata_work" value="${esc(part.tabata_work !== undefined ? part.tabata_work : 20)}" />
            </div>
            <div class="field" style="margin-bottom:0;">
              <label style="color:#10b981; font-weight:700;">🟢 Descanso (segundos)</label>
              <input class="input" type="number" min="0" max="300" step="5" data-part-field="tabata_rest" value="${esc(part.tabata_rest !== undefined ? part.tabata_rest : 10)}" />
            </div>
            <div class="field" style="margin-bottom:0;">
              <label style="color:var(--text-main); font-weight:700;">Rondas (intervalos)</label>
              <input class="input" type="number" min="1" max="50" data-part-field="tabata_rounds" value="${esc(part.tabata_rounds !== undefined ? part.tabata_rounds : 8)}" />
            </div>
          </div>
        ` : ''}
        ${normalizedTimer === 'EMOM' ? `
          <div class="grid-2" style="background:rgba(2,132,199,0.06); border:1px solid rgba(2,132,199,0.22); border-radius:6px; padding:8px 10px; margin-top:8px;">
            <div class="field" style="margin-bottom:0;">
              <label style="color:#0284c7; font-weight:700;">Intervalo (segundos)</label>
              <input class="input" type="number" min="10" max="300" step="10" data-part-field="emom_interval" value="${esc(part.emom_interval !== undefined ? part.emom_interval : 60)}" />
            </div>
            <div class="field" style="margin-bottom:0;">
              <label style="color:var(--text-main); font-weight:700;">Rondas (intervalos)</label>
              <input class="input" type="number" min="1" max="60" data-part-field="emom_rounds" value="${esc(part.emom_rounds !== undefined ? part.emom_rounds : 10)}" />
            </div>
          </div>
        ` : ''}
      </div>
    `;

    box.querySelector('[data-del-part]').addEventListener('click', () => {
      state.currentDay.parts.splice(pIdx, 1);
      renderPartsList();
      triggerAutoSave(true);
    });
    box.querySelectorAll('[data-add-part-line]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!Array.isArray(part.exercises)) part.exercises = [];
        part.exercises.push({
          name: '',
          sets: '',
          reps: '',
          load: '',
          rest: '',
          notes: '',
          video_url: '',
        });
        renderPartsList();
        triggerAutoSave(true);
      });
    });
    box.querySelectorAll('[data-add-part-subblock]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!Array.isArray(part.exercises)) part.exercises = [];
        part.exercises.push(createSubBlockItem(''));
        renderPartsList();
        triggerAutoSave(true);
        showToast('📦 Cuadro añadido al bloque');
      });
    });
    box.querySelectorAll('[data-add-part-timed]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!Array.isArray(part.exercises)) part.exercises = [];
        part.exercises.push(createTimedSectionItem('AMRAP', 10));
        renderPartsList();
        triggerAutoSave(true);
        showToast('⏱ AMRAP añadido al bloque');
      });
    });
    box.querySelectorAll('[data-add-ex]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openExercisePicker({ type: 'part', partIdx: pIdx }, false);
      });
    });
    box.querySelector('[data-launch-part-crono]')?.addEventListener('click', () => {
      const mode = (part.timer_type || 'SIN CRONO').toUpperCase();
      if (mode === 'SIN CRONO') return showToast('El bloque no tiene formato de crono');
      const spec = {
        mode,
        minutes: Number(part.timer_minutes) || 12,
        workSec: Number(part.tabata_work !== undefined ? part.tabata_work : 20),
        restSec: Number(part.tabata_rest !== undefined ? part.tabata_rest : 10),
        tabataRounds: Number(part.tabata_rounds !== undefined ? part.tabata_rounds : 8),
        intervalSec: Number(part.emom_interval !== undefined ? part.emom_interval : 60),
      };
      openCoachCronoProModal(spec);
    });
    box.querySelectorAll('[data-part-field]').forEach((inp) => {
      const handler = () => {
        const field = inp.dataset.partField;
        if (field === 'has_score') {
          state.currentDay.parts[pIdx].has_score = inp.checked;
          triggerAutoSave(true);
          return;
        }
        const val = inp.value;
        state.currentDay.parts[pIdx][field] = val;
        if (field === 'timer_type') {
          if (val === 'TABATA') {
            if (part.tabata_work === undefined) part.tabata_work = 20;
            if (part.tabata_rest === undefined) part.tabata_rest = 10;
            if (part.tabata_rounds === undefined) part.tabata_rounds = 8;
            part.timer_minutes = Math.ceil(((Number(part.tabata_work) + Number(part.tabata_rest)) * Number(part.tabata_rounds)) / 60);
          } else if (val === 'EMOM') {
            if (part.emom_interval === undefined) part.emom_interval = 60;
            if (part.emom_rounds === undefined) part.emom_rounds = 10;
            part.timer_minutes = Math.round((Number(part.emom_interval) * Number(part.emom_rounds)) / 60);
          }
          renderPartsList();
          triggerAutoSave(true);
        } else if (field === 'tabata_work' || field === 'tabata_rest' || field === 'tabata_rounds') {
          const w = Number(part.tabata_work !== undefined ? part.tabata_work : 20);
          const r = Number(part.tabata_rest !== undefined ? part.tabata_rest : 10);
          const rounds = Number(part.tabata_rounds !== undefined ? part.tabata_rounds : 8);
          part.timer_minutes = Math.ceil(((w + r) * rounds) / 60);
          const minInp = box.querySelector('[data-part-field="timer_minutes"]');
          if (minInp) minInp.value = part.timer_minutes;
          triggerAutoSave(false);
        } else if (field === 'emom_interval' || field === 'emom_rounds') {
          const intSec = Number(part.emom_interval !== undefined ? part.emom_interval : 60);
          const rounds = Number(part.emom_rounds !== undefined ? part.emom_rounds : 10);
          part.timer_minutes = Math.round((intSec * rounds) / 60);
          const minInp = box.querySelector('[data-part-field="timer_minutes"]');
          if (minInp) minInp.value = part.timer_minutes;
          triggerAutoSave(false);
        } else {
          triggerAutoSave(false);
        }
      };
      inp.addEventListener('input', handler);
      inp.addEventListener('change', handler);
    });

    const exWrap = box.querySelector(`[data-part-ex-list="${pIdx}"]`);
    const partExercises = part.exercises || [];
    if (partExercises.length === 0) {
      exWrap.innerHTML = '<p class="muted" style="font-size:0.85rem; margin:6px 0;">Sin ejercicios añadidos. Pulsa "+ Añadir línea" o "📚 Biblioteca".</p>';
    } else {
      exWrap.innerHTML = '';

      const hdr = document.createElement('div');
      hdr.style.cssText = 'display:flex; align-items:center; gap:6px; padding:4px 10px; font-size:0.75rem; font-weight:800; color:#38bdf8; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;';
      hdr.innerHTML = `
        <div style="width:65px; text-align:center;">SETS</div>
        <div style="width:75px; text-align:center;">REPS</div>
        <div style="width:80px; text-align:center;">CARGA</div>
        <div style="width:65px; text-align:center;">DESC.</div>
        <div style="flex:1; min-width:130px;">MOVE</div>
        <div style="flex:1.2; min-width:150px;">VIDEO</div>
        <div style="width:160px; text-align:right;">ACCIONES</div>
      `;
      exWrap.appendChild(hdr);

      let partBoxNum = 0;

      partExercises.forEach((ex, eIdx) => {
        if (!Array.isArray(ex.sub_exercises)) ex.sub_exercises = [];

        // SECCIÓN CON CRONÓMETRO DENTRO DEL BLOQUE (AMRAP, EMOM, TABATA, FOR TIME)
        if (ex.is_timed_section) {
          partBoxNum += 1;
          const exRow = document.createElement('div');
          exRow.className = 'timed-section-coach-box';
          const curTimer = (ex.timer_type || 'AMRAP').toUpperCase();
          const normTimer = ['AMRAP', 'EMOM', 'TABATA', 'FOR TIME'].includes(curTimer) ? curTimer : 'AMRAP';

          let subExercisesHtml = '';
          (ex.sub_exercises || []).forEach((sub, sIdx) => {
            subExercisesHtml += `
              <div class="sub-ex-coach-row" style="margin-top:6px; padding-top:6px; border-top:1px dashed rgba(56,189,248,0.25); display:flex; flex-direction:column; gap:4px;">
                <div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; width:100%;">
                  <div style="width:65px; flex-shrink:0;">
                    <input class="input" style="padding:6px; font-size:0.85rem;" data-timed-sub-part-f="sets" data-sub-idx="${sIdx}" placeholder="SETS" value="${esc(sub.sets || '')}" title="Series o rondas (opcional)" />
                  </div>
                  <div style="width:75px; flex-shrink:0;">
                    <input class="input" style="padding:6px; font-size:0.85rem;" data-timed-sub-part-f="reps" data-sub-idx="${sIdx}" placeholder="REPS" value="${esc(sub.reps || '')}" title="Repeticiones o Tiempo (ej: 10 / 30s)" />
                  </div>
                  <div style="width:80px; flex-shrink:0;">
                    <input class="input" style="padding:6px; font-size:0.85rem;" data-timed-sub-part-f="load" data-sub-idx="${sIdx}" placeholder="CARGA" value="${esc(sub.load || '')}" title="Carga o peso (opcional)" />
                  </div>
                  <div style="width:65px; flex-shrink:0;"></div>
                  <div style="flex:1; min-width:130px;">
                    <input class="input" style="padding:6px; font-size:0.88rem; font-weight:700;" data-timed-sub-part-f="name" data-sub-idx="${sIdx}" list="libraryExercisesDatalist" placeholder="MOVE (ejercicio...)" value="${esc(sub.name || '')}" autocomplete="off" />
                  </div>
                  <div style="flex:1.2; min-width:150px; display:flex; align-items:center; gap:4px;">
                    <input class="input" style="padding:6px; font-size:0.82rem; flex:1;" data-timed-sub-part-f="video_url" data-sub-idx="${sIdx}" placeholder="VIDEO (URL vídeo...)" value="${esc(sub.video_url || '')}" />
                    <button class="btn btn-sm ${sub.video_url ? 'btn-primary' : 'btn-outline'}" type="button" data-play-timed-sub-part="${sIdx}" title="${sub.video_url ? 'Ver vídeo explicativo' : 'Buscar vídeo'}" style="padding:5px 8px; font-size:0.95rem;">🎬</button>
                  </div>
                  <div class="row-wrap" style="width:130px; justify-content:flex-end; gap:4px; flex-shrink:0;">
                    <button class="btn btn-sm btn-outline" type="button" data-search-timed-sub-part="${sIdx}" title="Buscar en biblioteca" style="padding:6px 8px;">🔍</button>
                    <button class="btn btn-danger btn-sm" type="button" data-del-timed-sub-part="${sIdx}" title="Quitar este ejercicio" style="padding:6px 8px;">✕</button>
                  </div>
                </div>
                <div>
                  <input class="input" style="padding:3px 6px; font-size:0.8rem; color:var(--text-muted); background:transparent; border:none; border-bottom:1px dashed rgba(255,255,255,0.08);" data-timed-sub-part-f="notes" data-sub-idx="${sIdx}" placeholder="Notas o detalles..." value="${esc(sub.notes || '')}" />
                </div>
              </div>
            `;
          });

          exRow.innerHTML = `
            <div class="row-between" style="align-items:center; margin-bottom:8px; gap:8px; flex-wrap:wrap;">
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="badge" style="background:#0284c7; color:#ffffff; font-weight:900; font-size:0.82rem; padding:4px 8px;">⏱ ${partBoxNum}.- CRONO EN BLOQUE</span>
                <select class="input" style="padding:4px 8px; font-size:0.85rem; font-weight:800; width:auto; color:#38bdf8; background:#0c121e; border-color:#0284c7;" data-part-timed-field="timer_type">
                  ${['AMRAP', 'EMOM', 'TABATA', 'FOR TIME'].map((opt) => `<option value="${opt}" ${normTimer === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                </select>
              </div>
              <div class="row-wrap" style="gap:6px;">
                <button class="btn btn-sm btn-outline" type="button" data-test-part-timed="${eIdx}" title="Probar en Crono Pro" style="border-color:#38bdf8; color:#38bdf8; font-weight:800;">⚡ Probar Crono Pro</button>
                <button class="btn btn-danger btn-sm" type="button" data-del-part-ex="${eIdx}" title="Eliminar este bloque con crono">✕</button>
              </div>
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:6px;">
              <div style="flex:2; min-width:180px;">
                <label style="font-size:0.75rem; color:#38bdf8; font-weight:700;">Título / Formato visible</label>
                <input class="input" style="padding:6px; font-size:0.88rem; font-weight:700;" data-part-timed-field="name" value="${esc(ex.name || '')}" placeholder="Ej: AMRAP (10 min) / Trabajo por tiempo..." />
              </div>
              <div style="flex:1; min-width:100px;">
                <label style="font-size:0.75rem; color:#38bdf8; font-weight:700;">Minutos / Cap</label>
                <input class="input" type="number" min="1" max="120" style="padding:6px; font-size:0.88rem;" data-part-timed-field="timer_minutes" value="${esc(ex.timer_minutes || 10)}" />
              </div>
            </div>

            ${normTimer === 'TABATA' ? `
              <div class="grid-3" style="background:rgba(0,0,0,0.25); border-radius:6px; padding:6px 8px; margin-bottom:6px;">
                <div><label style="font-size:0.75rem; color:#0284c7; font-weight:700;">Trabajo (s)</label><input class="input" type="number" min="5" max="300" step="5" data-part-timed-field="tabata_work" value="${esc(ex.tabata_work !== undefined ? ex.tabata_work : 20)}" style="padding:4px;" /></div>
                <div><label style="font-size:0.75rem; color:#10b981; font-weight:700;">Descanso (s)</label><input class="input" type="number" min="0" max="300" step="5" data-part-timed-field="tabata_rest" value="${esc(ex.tabata_rest !== undefined ? ex.tabata_rest : 10)}" style="padding:4px;" /></div>
                <div><label style="font-size:0.75rem; font-weight:700;">Rondas</label><input class="input" type="number" min="1" max="50" data-part-timed-field="tabata_rounds" value="${esc(ex.tabata_rounds !== undefined ? ex.tabata_rounds : 8)}" style="padding:4px;" /></div>
              </div>
            ` : ''}

            ${normTimer === 'EMOM' ? `
              <div class="grid-2" style="background:rgba(0,0,0,0.25); border-radius:6px; padding:6px 8px; margin-bottom:6px;">
                <div><label style="font-size:0.75rem; color:#0284c7; font-weight:700;">Cada (s)</label><input class="input" type="number" min="10" max="300" step="10" data-part-timed-field="emom_interval" value="${esc(ex.emom_interval !== undefined ? ex.emom_interval : 60)}" style="padding:4px;" /></div>
                <div><label style="font-size:0.75rem; font-weight:700;">Rondas</label><input class="input" type="number" min="1" max="60" data-part-timed-field="emom_rounds" value="${esc(ex.emom_rounds !== undefined ? ex.emom_rounds : 10)}" style="padding:4px;" /></div>
              </div>
            ` : ''}

            <div style="margin-bottom:6px;">
              <input class="input" style="padding:4px 6px; font-size:0.82rem;" data-part-timed-field="notes" value="${esc(ex.notes || '')}" placeholder="Descripción o estrategia del AMRAP/EMOM..." />
            </div>

            <div style="margin-top:8px; border-top:1px dashed rgba(56,189,248,0.3); padding-top:6px;">
              <div class="row-between" style="align-items:center; margin-bottom:4px;">
                <span style="font-size:0.75rem; font-weight:800; color:#38bdf8; text-transform:uppercase;">Ejercicios de este ${normTimer}</span>
                <div class="row-wrap" style="gap:4px;">
                  <button class="btn btn-sm btn-primary" type="button" data-add-sub-timed-part="${eIdx}" style="font-size:0.78rem; padding:3px 8px;">+ Añadir ejercicio</button>
                  <button class="btn btn-sm btn-outline" type="button" data-search-timed-sub-part-any="${eIdx}" style="font-size:0.78rem; padding:3px 8px;">📚 Biblioteca</button>
                </div>
              </div>
              ${(ex.sub_exercises || []).length > 0 ? `
                <div style="display:flex; align-items:center; gap:6px; padding:2px 8px; font-size:0.72rem; font-weight:800; color:#38bdf8; text-transform:uppercase; margin-bottom:2px;">
                  <div style="width:65px; text-align:center;">SETS</div>
                  <div style="width:75px; text-align:center;">REPS</div>
                  <div style="width:80px; text-align:center;">CARGA</div>
                  <div style="flex:1; min-width:130px;">MOVE</div>
                  <div style="flex:1.2; min-width:150px;">VIDEO</div>
                  <div style="width:130px; text-align:right;">ACCIONES</div>
                </div>
              ` : ''}
              ${subExercisesHtml}
            </div>
          `;

          exRow.querySelector(`[data-del-part-ex="${eIdx}"]`).addEventListener('click', () => {
            state.currentDay.parts[pIdx].exercises.splice(eIdx, 1);
            renderPartsList();
            triggerAutoSave(true);
          });

          exRow.querySelector(`[data-test-part-timed="${eIdx}"]`)?.addEventListener('click', () => {
            const spec = {
              mode: normTimer,
              minutes: Number(ex.timer_minutes) || 10,
              workSec: Number(ex.tabata_work !== undefined ? ex.tabata_work : 20),
              restSec: Number(ex.tabata_rest !== undefined ? ex.tabata_rest : 10),
              tabataRounds: Number(ex.tabata_rounds !== undefined ? ex.tabata_rounds : 8),
              intervalSec: Number(ex.emom_interval !== undefined ? ex.emom_interval : 60),
              rounds: Number(ex.emom_rounds !== undefined ? ex.emom_rounds : 10)
            };
            openCoachCronoProModal(spec);
          });

          exRow.querySelectorAll('[data-part-timed-field]').forEach((inp) => {
            const handler = () => {
              const field = inp.dataset.partTimedField;
              const val = inp.value;
              state.currentDay.parts[pIdx].exercises[eIdx][field] = val;
              if (field === 'timer_type') {
                const nextNorm = ['AMRAP', 'EMOM', 'TABATA', 'FOR TIME'].includes(val) ? val : 'AMRAP';
                if (nextNorm === 'TABATA') {
                  if (ex.tabata_work === undefined) ex.tabata_work = 20;
                  if (ex.tabata_rest === undefined) ex.tabata_rest = 10;
                  if (ex.tabata_rounds === undefined) ex.tabata_rounds = 8;
                  ex.timer_minutes = Math.ceil(((Number(ex.tabata_work) + Number(ex.tabata_rest)) * Number(ex.tabata_rounds)) / 60);
                } else if (nextNorm === 'EMOM') {
                  if (ex.emom_interval === undefined) ex.emom_interval = 60;
                  if (ex.emom_rounds === undefined) ex.emom_rounds = 10;
                  ex.timer_minutes = Math.round((Number(ex.emom_interval) * Number(ex.emom_rounds)) / 60);
                }
                if (!ex.name || ex.name.startsWith('AMRAP') || ex.name.startsWith('EMOM') || ex.name.startsWith('TABATA') || ex.name.startsWith('FOR TIME')) {
                  ex.name = `${nextNorm} (${ex.timer_minutes || 10} min)`;
                }
                renderPartsList();
                triggerAutoSave(true);
              } else if (field === 'tabata_work' || field === 'tabata_rest' || field === 'tabata_rounds') {
                const w = Number(ex.tabata_work !== undefined ? ex.tabata_work : 20);
                const r = Number(ex.tabata_rest !== undefined ? ex.tabata_rest : 10);
                const rounds = Number(ex.tabata_rounds !== undefined ? ex.tabata_rounds : 8);
                ex.timer_minutes = Math.ceil(((w + r) * rounds) / 60);
                triggerAutoSave(false);
              } else if (field === 'emom_interval' || field === 'emom_rounds') {
                const intSec = Number(ex.emom_interval !== undefined ? ex.emom_interval : 60);
                const rounds = Number(ex.emom_rounds !== undefined ? ex.emom_rounds : 10);
                ex.timer_minutes = Math.round((intSec * rounds) / 60);
                triggerAutoSave(false);
              } else {
                triggerAutoSave(false);
              }
            };
            inp.addEventListener('input', handler);
            inp.addEventListener('change', handler);
          });

          exRow.querySelector(`[data-add-sub-timed-part="${eIdx}"]`)?.addEventListener('click', () => {
            if (!Array.isArray(state.currentDay.parts[pIdx].exercises[eIdx].sub_exercises)) {
              state.currentDay.parts[pIdx].exercises[eIdx].sub_exercises = [];
            }
            state.currentDay.parts[pIdx].exercises[eIdx].sub_exercises.push({
              sets: '',
              reps: '10',
              load: '',
              name: '',
              video_url: '',
              notes: ''
            });
            renderPartsList();
            triggerAutoSave(true);
          });

          exRow.querySelector(`[data-search-timed-sub-part-any="${eIdx}"]`)?.addEventListener('click', () => {
            openExercisePicker({ type: 'timed_part_sub_add', partIdx: pIdx, exIdx: eIdx }, false);
          });

          (ex.sub_exercises || []).forEach((sub, sIdx) => {
            exRow.querySelector(`[data-del-timed-sub-part="${sIdx}"]`)?.addEventListener('click', () => {
              state.currentDay.parts[pIdx].exercises[eIdx].sub_exercises.splice(sIdx, 1);
              renderPartsList();
              triggerAutoSave(true);
            });

            exRow.querySelector(`[data-search-timed-sub-part="${sIdx}"]`)?.addEventListener('click', () => {
              openExercisePicker({ type: 'timed_part_sub_replace', partIdx: pIdx, exIdx: eIdx, subIdx: sIdx }, false, sub.name);
            });

            exRow.querySelector(`[data-play-timed-sub-part="${sIdx}"]`)?.addEventListener('click', () => {
              const curSub = state.currentDay.parts[pIdx].exercises[eIdx].sub_exercises[sIdx];
              if (curSub?.video_url) {
                openVideoModal(curSub.name, curSub.video_url);
              } else {
                openExercisePicker({ type: 'timed_part_sub_replace', partIdx: pIdx, exIdx: eIdx, subIdx: sIdx }, false, curSub.name);
              }
            });

            exRow.querySelectorAll(`[data-timed-sub-part-f][data-sub-idx="${sIdx}"]`).forEach((inp) => {
              const handleTimedSubInput = (isImmediate) => {
                state.currentDay.parts[pIdx].exercises[eIdx].sub_exercises[sIdx][inp.dataset.timedSubPartF] = inp.value;
                if (inp.dataset.timedSubPartF === 'name') {
                  const subRowEl = inp.closest('.sub-ex-coach-row');
                  if (subRowEl) {
                    tryAutoLinkExercise(state.currentDay.parts[pIdx].exercises[eIdx].sub_exercises[sIdx], subRowEl, 'video_url');
                  }
                }
                triggerAutoSave(isImmediate);
              };
              inp.addEventListener('input', () => handleTimedSubInput(false));
              inp.addEventListener('change', () => handleTimedSubInput(true));
              inp.addEventListener('blur', () => {
                if (inp.dataset.timedSubPartF === 'name') {
                  const subRowEl = inp.closest('.sub-ex-coach-row');
                  if (subRowEl) {
                    tryAutoLinkExercise(state.currentDay.parts[pIdx].exercises[eIdx].sub_exercises[sIdx], subRowEl, 'video_url');
                  }
                }
              });
            });
          });

          exWrap.appendChild(exRow);
          return;
        }

        if (ex.is_sub_block) {
          partBoxNum += 1;
          const exRow = renderSubBlockCoachBox(ex, partBoxNum, {
            showLoad: true,
            onDelete: () => {
              state.currentDay.parts[pIdx].exercises.splice(eIdx, 1);
              renderPartsList();
              triggerAutoSave(true);
            },
            onAddSub: () => {
              ex.sub_exercises.push({ sets: '', reps: '10', load: '', name: '', video_url: '', notes: '' });
              renderPartsList();
              triggerAutoSave(true);
            },
            onAddSubLib: () => openExercisePicker({ type: 'timed_part_sub_add', partIdx: pIdx, exIdx: eIdx }, false),
            onDelSub: (sIdx) => {
              ex.sub_exercises.splice(sIdx, 1);
              renderPartsList();
              triggerAutoSave(true);
            },
            onSearchSub: (sIdx) => openExercisePicker({ type: 'timed_part_sub_replace', partIdx: pIdx, exIdx: eIdx, subIdx: sIdx }, false),
            onPlaySub: (sIdx) => {
              const curSub = ex.sub_exercises[sIdx];
              if (curSub && curSub.video_url) openVideoPreviewModal(curSub.name || 'Ejercicio', curSub.video_url, curSub.notes || '');
              else openExercisePicker({ type: 'timed_part_sub_replace', partIdx: pIdx, exIdx: eIdx, subIdx: sIdx }, false);
            },
          });
          exWrap.appendChild(exRow);
          return;
        }

        const hasSubs = ex.sub_exercises.length > 0;
        const exRow = document.createElement('div');
        exRow.className = 'ex-coach-line';
        if (hasSubs) {
          exRow.style.borderLeft = '3px solid #38bdf8';
          exRow.style.background = 'rgba(56,189,248,0.03)';
          exRow.style.paddingLeft = '10px';
        }

        let subHtml = '';
        ex.sub_exercises.forEach((sub, subIdx) => {
          subHtml += `
            <div class="sub-ex-coach-row" style="margin-top:8px; padding-top:6px; border-top:1px dashed rgba(56,189,248,0.25); display:flex; flex-direction:column; gap:4px;">
              <div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; width:100%;">
                <div style="width:65px; flex-shrink:0; display:flex; align-items:center; justify-content:center;">
                  <span class="badge" style="background:rgba(56,189,248,0.2); color:#38bdf8; font-weight:800; font-size:0.75rem; padding:4px 6px; width:100%; text-align:center;">+ ${subIdx + 2}</span>
                </div>
                <div style="width:75px; flex-shrink:0;">
                  <input class="input" style="padding:6px; font-size:0.85rem;" data-sub-part-f="reps" data-sub-idx="${subIdx}" placeholder="REPS" value="${esc(sub.reps || '')}" title="REPS (Repeticiones)" />
                </div>
                <div style="width:80px; flex-shrink:0;">
                  <input class="input" style="padding:6px; font-size:0.85rem;" data-sub-part-f="load" data-sub-idx="${subIdx}" placeholder="CARGA" value="${esc(sub.load || '')}" title="CARGA o %RM" />
                </div>
                <div style="width:65px; flex-shrink:0;"></div>
                <div style="flex:1; min-width:130px;">
                  <input class="input" style="padding:6px; font-size:0.88rem; font-weight:700;" data-sub-part-f="name" data-sub-idx="${subIdx}" list="libraryExercisesDatalist" placeholder="MOVE (ejercicio...)" value="${esc(sub.name || '')}" autocomplete="off" />
                </div>
                <div style="flex:1.2; min-width:150px; display:flex; align-items:center; gap:4px;">
                  <input class="input" style="padding:6px; font-size:0.82rem; flex:1;" data-sub-part-f="video_url" data-sub-idx="${subIdx}" placeholder="VIDEO (URL vídeo...)" value="${esc(sub.video_url || '')}" />
                  <button class="btn btn-sm ${sub.video_url ? 'btn-primary' : 'btn-outline'}" type="button" data-play-sub-part="${subIdx}" title="Ver vídeo" style="padding:5px 8px; font-size:0.95rem;">🎬</button>
                </div>
                <div class="row-wrap" style="width:160px; justify-content:flex-end; gap:4px; flex-shrink:0;">
                  <button class="btn btn-sm btn-outline" type="button" data-add-sub-part="${eIdx}" title="Añadir otro ejercicio dentro de este bloque (+)" style="padding:6px 9px; font-weight:800; color:#38bdf8; font-size:1rem;">+</button>
                  <button class="btn btn-sm btn-outline" type="button" data-search-sub-part="${subIdx}" title="Buscar en biblioteca" style="padding:6px 8px;">🔍</button>
                  <button class="btn btn-danger btn-sm" type="button" data-del-sub-part="${subIdx}" title="Eliminar este ejercicio" style="padding:6px 8px;">✕</button>
                </div>
              </div>
              <div>
                <input class="input" style="padding:3px 6px; font-size:0.8rem; color:var(--text-muted); background:transparent; border:none; border-bottom:1px dashed rgba(255,255,255,0.08);" data-sub-part-f="notes" data-sub-idx="${subIdx}" placeholder="Notas de este ejercicio..." value="${esc(sub.notes || '')}" />
              </div>
            </div>
          `;
        });

        exRow.innerHTML = `
          <div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; width:100%;">
            <div style="width:65px; flex-shrink:0;">
              ${hasSubs
                ? `<div style="display:flex; align-items:center; gap:4px;"><span class="badge" style="background:rgba(56,189,248,0.2); color:#38bdf8; font-weight:800; font-size:0.75rem; padding:4px 5px;">1</span><input class="input" style="padding:6px; font-size:0.85rem; width:100%;" data-ex-f="sets" placeholder="SETS" value="${esc(ex.sets || '')}" title="SETS (Series)" /></div>`
                : `<input class="input" style="padding:6px; font-size:0.85rem; width:100%;" data-ex-f="sets" placeholder="SETS" value="${esc(ex.sets || '')}" title="SETS (Series del bloque)" />`
              }
            </div>
            <div style="width:75px; flex-shrink:0;">
              <input class="input" style="padding:6px; font-size:0.85rem;" data-ex-f="reps" placeholder="REPS" value="${esc(ex.reps || '')}" title="REPS (Repeticiones)" />
            </div>
            <div style="width:80px; flex-shrink:0;">
              <input class="input" style="padding:6px; font-size:0.85rem;" data-ex-f="load" placeholder="CARGA" value="${esc(ex.load || '')}" title="CARGA o %RM" />
            </div>
            <div style="width:65px; flex-shrink:0;">
              <input class="input" style="padding:6px; font-size:0.85rem;" data-ex-f="rest" placeholder="DESC." value="${esc(ex.rest || '')}" title="DESC. (Descanso)" />
            </div>
            <div style="flex:1; min-width:130px;">
              <input class="input" style="padding:6px; font-size:0.88rem; font-weight:700;" data-ex-f="name" list="libraryExercisesDatalist" placeholder="${eIdx + 1}.- MOVE (ejercicio...)" value="${esc(ex.name || '')}" autocomplete="off" />
            </div>
            <div style="flex:1.2; min-width:150px; display:flex; align-items:center; gap:4px;">
              <input class="input" style="padding:6px; font-size:0.82rem; flex:1;" data-ex-f="video_url" placeholder="VIDEO (URL vídeo...)" value="${esc(ex.video_url || '')}" />
              <button class="btn btn-sm ${ex.video_url ? 'btn-primary' : 'btn-outline'}" type="button" data-play-ex title="${ex.video_url ? 'Ver vídeo explicativo' : 'Buscar vídeo'}" style="padding:5px 8px; font-size:0.95rem;">
                🎬
              </button>
            </div>
            <div class="row-wrap" style="width:160px; justify-content:flex-end; gap:4px; flex-shrink:0;">
              <button class="btn btn-sm btn-outline" type="button" data-add-timed-part-ex="${pIdx}" data-ex-idx="${eIdx}" title="Añadir AMRAP, EMOM, TABATA o FOR TIME después de este ejercicio" style="padding:6px 8px; font-weight:800; color:#38bdf8; border-color:rgba(56,189,248,0.5);">⏱+</button>
              <button class="btn btn-sm btn-outline" type="button" data-add-sub-part="${eIdx}" title="Añadir otro ejercicio dentro de este bloque (+)" style="padding:6px 9px; font-weight:800; color:#38bdf8; border-color:rgba(56,189,248,0.4); font-size:1rem;">
                +
              </button>
              <button class="btn btn-sm btn-outline" type="button" data-search-lib-part="${eIdx}" title="Buscar en la biblioteca de ejercicios" style="padding:6px 8px;">🔍</button>
              <button class="btn btn-sm btn-outline" type="button" data-save-lib title="Guardar en biblioteca" style="padding:6px 8px;">💾</button>
              <button class="btn btn-danger btn-sm" type="button" data-del-ex title="Eliminar ejercicio" style="padding:6px 8px;">✕</button>
            </div>
          </div>
          <div style="margin-top:4px;">
            <input class="input" style="padding:3px 6px; font-size:0.8rem; color:var(--text-muted); background:transparent; border:none; border-bottom:1px dashed rgba(255,255,255,0.1);" data-ex-f="notes" placeholder="Notas técnicas opcionales..." value="${esc(ex.notes || '')}" />
          </div>
          ${subHtml}
        `;

        // Botón ⏱+ para añadir AMRAP/EMOM después de este ejercicio en el bloque
        exRow.querySelector(`[data-add-timed-part-ex="${pIdx}"][data-ex-idx="${eIdx}"]`)?.addEventListener('click', () => {
          state.currentDay.parts[pIdx].exercises.splice(eIdx + 1, 0, createTimedSectionItem('AMRAP', 10));
          renderPartsList();
          triggerAutoSave(true);
          showToast('⏱ AMRAP añadido después del ejercicio');
        });

        // Add sub-exercise to superserie in part
        exRow.querySelectorAll(`[data-add-sub-part="${eIdx}"]`).forEach((btn) => {
          btn.addEventListener('click', () => {
            if (!Array.isArray(state.currentDay.parts[pIdx].exercises[eIdx].sub_exercises)) {
              state.currentDay.parts[pIdx].exercises[eIdx].sub_exercises = [];
            }
            state.currentDay.parts[pIdx].exercises[eIdx].sub_exercises.push({
              name: '',
              reps: '',
              load: '',
              video_url: '',
              notes: '',
            });
            renderPartsList();
            triggerAutoSave(true);
          });
        });

        exRow.querySelector('[data-del-ex]').addEventListener('click', () => {
          state.currentDay.parts[pIdx].exercises.splice(eIdx, 1);
          renderPartsList();
          triggerAutoSave(true);
        });
        exRow.querySelector(`[data-search-lib-part="${eIdx}"]`)?.addEventListener('click', () => {
          openExercisePicker({ type: 'part_replace', partIdx: pIdx, exIdx: eIdx }, false, ex.name);
        });
        const play = exRow.querySelector('[data-play-ex]');
        if (play) {
          play.addEventListener('click', () => {
            const url = state.currentDay.parts[pIdx].exercises[eIdx].video_url;
            if (url) {
              openVideoModal(ex.name, url);
            } else {
              openExercisePicker({ type: 'part_replace', partIdx: pIdx, exIdx: eIdx }, false, ex.name);
            }
          });
        }
        exRow.querySelector('[data-save-lib]')?.addEventListener('click', async () => {
          const cur = state.currentDay.parts[pIdx].exercises[eIdx];
          const ok = await saveExerciseToLibrary({
            name: cur.name,
            video_url: cur.video_url,
            notes: cur.notes,
            category: part.type || 'Fuerza',
          });
          if (ok) renderPartsList();
        });
        exRow.querySelectorAll('[data-ex-f]').forEach((inp) => {
          const handleExInput = (isImmediate) => {
            state.currentDay.parts[pIdx].exercises[eIdx][inp.dataset.exF] = inp.value;
            if (inp.dataset.exF === 'name') {
              tryAutoLinkExercise(state.currentDay.parts[pIdx].exercises[eIdx], exRow, 'video_url');
            }
            triggerAutoSave(isImmediate);
          };
          inp.addEventListener('input', () => handleExInput(false));
          inp.addEventListener('change', () => handleExInput(true));
          inp.addEventListener('blur', () => {
            if (inp.dataset.exF === 'name') {
              tryAutoLinkExercise(state.currentDay.parts[pIdx].exercises[eIdx], exRow, 'video_url');
            }
          });
        });

        // Sub-exercises in parts
        ex.sub_exercises.forEach((sub, subIdx) => {
          exRow.querySelector(`[data-del-sub-part="${subIdx}"]`)?.addEventListener('click', () => {
            state.currentDay.parts[pIdx].exercises[eIdx].sub_exercises.splice(subIdx, 1);
            renderPartsList();
            triggerAutoSave(true);
          });
          exRow.querySelector(`[data-search-sub-part="${subIdx}"]`)?.addEventListener('click', () => {
            openExercisePicker({ type: 'part_sub_replace', partIdx: pIdx, exIdx: eIdx, subIdx }, false, sub.name);
          });
          exRow.querySelector(`[data-play-sub-part="${subIdx}"]`)?.addEventListener('click', () => {
            const curSub = state.currentDay.parts[pIdx].exercises[eIdx].sub_exercises[subIdx];
            if (curSub?.video_url) {
              openVideoModal(curSub.name, curSub.video_url);
            } else {
              openExercisePicker({ type: 'part_sub_replace', partIdx: pIdx, exIdx: eIdx, subIdx }, false, curSub.name);
            }
          });
          exRow.querySelectorAll(`[data-sub-part-f][data-sub-idx="${subIdx}"]`).forEach((inp) => {
            const handleSubInput = (isImmediate) => {
              state.currentDay.parts[pIdx].exercises[eIdx].sub_exercises[subIdx][inp.dataset.subPartF] = inp.value;
              if (inp.dataset.subPartF === 'name') {
                const subRowEl = inp.closest('.sub-ex-coach-row');
                if (subRowEl) {
                  tryAutoLinkExercise(state.currentDay.parts[pIdx].exercises[eIdx].sub_exercises[subIdx], subRowEl, 'video_url');
                }
              }
              triggerAutoSave(isImmediate);
            };
            inp.addEventListener('input', () => handleSubInput(false));
            inp.addEventListener('change', () => handleSubInput(true));
            inp.addEventListener('blur', () => {
              if (inp.dataset.subPartF === 'name') {
                const subRowEl = inp.closest('.sub-ex-coach-row');
                if (subRowEl) {
                  tryAutoLinkExercise(state.currentDay.parts[pIdx].exercises[eIdx].sub_exercises[subIdx], subRowEl, 'video_url');
                }
              }
            });
          });
        });

        exWrap.appendChild(exRow);
      });
    }

    list.appendChild(box);
  });
}

function renderWodExercisesList() {
  const list = $('wodExercisesList') || $('wodMovementsList');
  if (!list || !state.currentDay) return;
  if (!state.currentDay.wod) state.currentDay.wod = {};
  if (!Array.isArray(state.currentDay.wod.exercises)) {
    state.currentDay.wod.exercises = [];
  }
  const items = state.currentDay.wod.exercises;
  if (items.length === 0) {
    list.innerHTML = '<p class="muted" style="margin:8px 0;">Sin ejercicios añadidos en el WOD Final. Pulsa "+ Añadir Ejercicio", "📚 Biblioteca" o utiliza el "⚡ Generador de WOD".</p>';
    return;
  }
  list.innerHTML = '';

  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex; align-items:center; gap:6px; padding:4px 10px; font-size:0.75rem; font-weight:800; color:#38bdf8; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;';
  hdr.innerHTML = `
    <div style="width:75px; text-align:center;">SETS</div>
    <div style="width:85px; text-align:center;">REPS</div>
    <div style="flex:1; min-width:140px;">MOVE</div>
    <div style="flex:1.2; min-width:160px;">VIDEO</div>
    <div style="width:160px; text-align:right;">ACCIONES</div>
  `;
  list.appendChild(hdr);

  let wodBoxNum = 0;

  items.forEach((item, idx) => {
    if (!Array.isArray(item.sub_exercises)) item.sub_exercises = [];

    // SECCIÓN CON CRONÓMETRO DENTRO DEL WOD (AMRAP, EMOM, TABATA, FOR TIME)
    if (item.is_timed_section) {
      wodBoxNum += 1;
      const row = document.createElement('div');
      row.className = 'timed-section-coach-box';
      const curTimer = (item.timer_type || 'AMRAP').toUpperCase();
      const normTimer = ['AMRAP', 'EMOM', 'TABATA', 'FOR TIME'].includes(curTimer) ? curTimer : 'AMRAP';

      let subExercisesHtml = '';
      (item.sub_exercises || []).forEach((sub, sIdx) => {
        subExercisesHtml += `
          <div class="sub-ex-coach-row" style="margin-top:6px; padding-top:6px; border-top:1px dashed rgba(56,189,248,0.25); display:flex; flex-direction:column; gap:4px;">
            <div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; width:100%;">
              <div style="width:75px; flex-shrink:0;">
                <input class="input" style="padding:6px; font-size:0.85rem;" data-timed-sub-wod-f="sets" data-sub-idx="${sIdx}" placeholder="SETS" value="${esc(sub.sets || '')}" title="Series o rondas (opcional)" />
              </div>
              <div style="width:85px; flex-shrink:0;">
                <input class="input" style="padding:6px; font-size:0.85rem;" data-timed-sub-wod-f="reps" data-sub-idx="${sIdx}" placeholder="REPS" value="${esc(sub.reps || '')}" title="Repeticiones o Tiempo (ej: 10 / 30s)" />
              </div>
              <div style="flex:1; min-width:140px;">
                <input class="input" style="padding:6px; font-size:0.88rem; font-weight:700;" data-timed-sub-wod-f="name" data-sub-idx="${sIdx}" list="libraryExercisesDatalist" placeholder="MOVE (ejercicio...)" value="${esc(sub.name || '')}" autocomplete="off" />
              </div>
              <div style="flex:1.2; min-width:160px; display:flex; align-items:center; gap:4px;">
                <input class="input" style="padding:6px; font-size:0.82rem; flex:1;" data-timed-sub-wod-f="video_url" data-sub-idx="${sIdx}" placeholder="VIDEO (URL vídeo...)" value="${esc(sub.video_url || '')}" />
                <button class="btn btn-sm ${sub.video_url ? 'btn-primary' : 'btn-outline'}" type="button" data-play-timed-sub-wod="${sIdx}" title="${sub.video_url ? 'Ver vídeo explicativo' : 'Buscar vídeo'}" style="padding:5px 8px; font-size:0.95rem;">🎬</button>
              </div>
              <div class="row-wrap" style="width:130px; justify-content:flex-end; gap:4px; flex-shrink:0;">
                <button class="btn btn-sm btn-outline" type="button" data-search-timed-sub-wod="${sIdx}" title="Buscar en biblioteca" style="padding:6px 8px;">🔍</button>
                <button class="btn btn-danger btn-sm" type="button" data-del-timed-sub-wod="${sIdx}" title="Quitar este ejercicio" style="padding:6px 8px;">✕</button>
              </div>
            </div>
            <div>
              <input class="input" style="padding:3px 6px; font-size:0.8rem; color:var(--text-muted); background:transparent; border:none; border-bottom:1px dashed rgba(255,255,255,0.08);" data-timed-sub-wod-f="notes" data-sub-idx="${sIdx}" placeholder="Notas o detalles..." value="${esc(sub.notes || '')}" />
            </div>
          </div>
        `;
      });

      row.innerHTML = `
        <div class="row-between" style="align-items:center; margin-bottom:8px; gap:8px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="badge" style="background:#f59e0b; color:#000000; font-weight:900; font-size:0.82rem; padding:4px 8px;">⏱ ${wodBoxNum}.- CRONO EN WOD</span>
            <select class="input" style="padding:4px 8px; font-size:0.85rem; font-weight:800; width:auto; color:#f59e0b; background:#0c121e; border-color:#f59e0b;" data-wod-timed-field="timer_type">
              ${['AMRAP', 'EMOM', 'TABATA', 'FOR TIME'].map((opt) => `<option value="${opt}" ${normTimer === opt ? 'selected' : ''}>${opt}</option>`).join('')}
            </select>
          </div>
          <div class="row-wrap" style="gap:6px;">
            <button class="btn btn-sm btn-outline" type="button" data-test-wod-timed="${idx}" title="Probar en Crono Pro" style="border-color:#f59e0b; color:#f59e0b; font-weight:800;">⚡ Probar Crono Pro</button>
            <button class="btn btn-danger btn-sm" type="button" data-del-wod-ex="${idx}" title="Eliminar este bloque con crono">✕</button>
          </div>
        </div>

        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:6px;">
          <div style="flex:2; min-width:180px;">
            <label style="font-size:0.75rem; color:#f59e0b; font-weight:700;">Título / Formato visible</label>
            <input class="input" style="padding:6px; font-size:0.88rem; font-weight:700;" data-wod-timed-field="name" value="${esc(item.name || '')}" placeholder="Ej: AMRAP (10 min) / 21-15-9..." />
          </div>
          <div style="flex:1; min-width:100px;">
            <label style="font-size:0.75rem; color:#f59e0b; font-weight:700;">Minutos / Cap</label>
            <input class="input" type="number" min="1" max="120" style="padding:6px; font-size:0.88rem;" data-wod-timed-field="timer_minutes" value="${esc(item.timer_minutes || 10)}" />
          </div>
        </div>

        ${normTimer === 'TABATA' ? `
          <div class="grid-3" style="background:rgba(0,0,0,0.25); border-radius:6px; padding:6px 8px; margin-bottom:6px;">
            <div><label style="font-size:0.75rem; color:#f59e0b; font-weight:700;">Trabajo (s)</label><input class="input" type="number" min="5" max="300" step="5" data-wod-timed-field="tabata_work" value="${esc(item.tabata_work !== undefined ? item.tabata_work : 20)}" style="padding:4px;" /></div>
            <div><label style="font-size:0.75rem; color:#10b981; font-weight:700;">Descanso (s)</label><input class="input" type="number" min="0" max="300" step="5" data-wod-timed-field="tabata_rest" value="${esc(item.tabata_rest !== undefined ? item.tabata_rest : 10)}" style="padding:4px;" /></div>
            <div><label style="font-size:0.75rem; font-weight:700;">Rondas</label><input class="input" type="number" min="1" max="50" data-wod-timed-field="tabata_rounds" value="${esc(item.tabata_rounds !== undefined ? item.tabata_rounds : 8)}" style="padding:4px;" /></div>
          </div>
        ` : ''}

        ${normTimer === 'EMOM' ? `
          <div class="grid-2" style="background:rgba(0,0,0,0.25); border-radius:6px; padding:6px 8px; margin-bottom:6px;">
            <div><label style="font-size:0.75rem; color:#f59e0b; font-weight:700;">Cada (s)</label><input class="input" type="number" min="10" max="300" step="10" data-wod-timed-field="emom_interval" value="${esc(item.emom_interval !== undefined ? item.emom_interval : 60)}" style="padding:4px;" /></div>
            <div><label style="font-size:0.75rem; font-weight:700;">Rondas</label><input class="input" type="number" min="1" max="60" data-wod-timed-field="emom_rounds" value="${esc(item.emom_rounds !== undefined ? item.emom_rounds : 10)}" style="padding:4px;" /></div>
          </div>
        ` : ''}

        <div style="margin-bottom:6px;">
          <input class="input" style="padding:4px 6px; font-size:0.82rem;" data-wod-timed-field="notes" value="${esc(item.notes || '')}" placeholder="Descripción o estrategia (ej: 10 Burpees + 15 KB Swings sin parar)..." />
        </div>

        <div style="margin-top:8px; border-top:1px dashed rgba(245,158,11,0.3); padding-top:6px;">
          <div class="row-between" style="align-items:center; margin-bottom:4px;">
            <span style="font-size:0.75rem; font-weight:800; color:#f59e0b; text-transform:uppercase;">Ejercicios de este ${normTimer}</span>
            <div class="row-wrap" style="gap:4px;">
              <button class="btn btn-sm btn-primary" type="button" data-add-sub-timed-wod="${idx}" style="font-size:0.78rem; padding:3px 8px;">+ Añadir ejercicio</button>
              <button class="btn btn-sm btn-outline" type="button" data-search-timed-sub-wod-any="${idx}" style="font-size:0.78rem; padding:3px 8px;">📚 Biblioteca</button>
            </div>
          </div>
          ${(item.sub_exercises || []).length > 0 ? `
            <div style="display:flex; align-items:center; gap:6px; padding:2px 8px; font-size:0.72rem; font-weight:800; color:#38bdf8; text-transform:uppercase; margin-bottom:2px;">
              <div style="width:75px; text-align:center;">SETS</div>
              <div style="width:85px; text-align:center;">REPS</div>
              <div style="flex:1; min-width:140px;">MOVE</div>
              <div style="flex:1.2; min-width:160px;">VIDEO</div>
              <div style="width:130px; text-align:right;">ACCIONES</div>
            </div>
          ` : ''}
          ${subExercisesHtml}
        </div>
      `;

      row.querySelector('[data-del-wod-ex]').addEventListener('click', () => {
        state.currentDay.wod.exercises.splice(idx, 1);
        renderWodExercisesList();
        triggerAutoSave(true);
      });

      row.querySelector(`[data-test-wod-timed="${idx}"]`)?.addEventListener('click', () => {
        const spec = {
          mode: normTimer,
          minutes: Number(item.timer_minutes) || 10,
          workSec: Number(item.tabata_work !== undefined ? item.tabata_work : 20),
          restSec: Number(item.tabata_rest !== undefined ? item.tabata_rest : 10),
          tabataRounds: Number(item.tabata_rounds !== undefined ? item.tabata_rounds : 8),
          intervalSec: Number(item.emom_interval !== undefined ? item.emom_interval : 60),
          rounds: Number(item.emom_rounds !== undefined ? item.emom_rounds : 10)
        };
        openCoachCronoProModal(spec);
      });

      row.querySelectorAll('[data-wod-timed-field]').forEach((inp) => {
        const handler = () => {
          const field = inp.dataset.wodTimedField;
          const val = inp.value;
          state.currentDay.wod.exercises[idx][field] = val;
          if (field === 'timer_type') {
            const nextNorm = ['AMRAP', 'EMOM', 'TABATA', 'FOR TIME'].includes(val) ? val : 'AMRAP';
            if (nextNorm === 'TABATA') {
              if (item.tabata_work === undefined) item.tabata_work = 20;
              if (item.tabata_rest === undefined) item.tabata_rest = 10;
              if (item.tabata_rounds === undefined) item.tabata_rounds = 8;
              item.timer_minutes = Math.ceil(((Number(item.tabata_work) + Number(item.tabata_rest)) * Number(item.tabata_rounds)) / 60);
            } else if (nextNorm === 'EMOM') {
              if (item.emom_interval === undefined) item.emom_interval = 60;
              if (item.emom_rounds === undefined) item.emom_rounds = 10;
              item.timer_minutes = Math.round((Number(item.emom_interval) * Number(item.emom_rounds)) / 60);
            }
            if (!item.name || item.name.startsWith('AMRAP') || item.name.startsWith('EMOM') || item.name.startsWith('TABATA') || item.name.startsWith('FOR TIME')) {
              item.name = `${nextNorm} (${item.timer_minutes || 10} min)`;
            }
            renderWodExercisesList();
            triggerAutoSave(true);
          } else if (field === 'tabata_work' || field === 'tabata_rest' || field === 'tabata_rounds') {
            const w = Number(item.tabata_work !== undefined ? item.tabata_work : 20);
            const r = Number(item.tabata_rest !== undefined ? item.tabata_rest : 10);
            const rounds = Number(item.tabata_rounds !== undefined ? item.tabata_rounds : 8);
            item.timer_minutes = Math.ceil(((w + r) * rounds) / 60);
            triggerAutoSave(false);
          } else if (field === 'emom_interval' || field === 'emom_rounds') {
            const intSec = Number(item.emom_interval !== undefined ? item.emom_interval : 60);
            const rounds = Number(item.emom_rounds !== undefined ? item.emom_rounds : 10);
            item.timer_minutes = Math.round((intSec * rounds) / 60);
            triggerAutoSave(false);
          } else {
            triggerAutoSave(false);
          }
        };
        inp.addEventListener('input', handler);
        inp.addEventListener('change', handler);
      });

      row.querySelector(`[data-add-sub-timed-wod="${idx}"]`)?.addEventListener('click', () => {
        if (!Array.isArray(state.currentDay.wod.exercises[idx].sub_exercises)) {
          state.currentDay.wod.exercises[idx].sub_exercises = [];
        }
        state.currentDay.wod.exercises[idx].sub_exercises.push({
          sets: '',
          reps: '10',
          name: '',
          video_url: '',
          notes: ''
        });
        renderWodExercisesList();
        triggerAutoSave(true);
      });

      row.querySelector(`[data-search-timed-sub-wod-any="${idx}"]`)?.addEventListener('click', () => {
        openExercisePicker({ type: 'timed_wod_sub_add', idx }, false);
      });

      (item.sub_exercises || []).forEach((sub, sIdx) => {
        row.querySelector(`[data-del-timed-sub-wod="${sIdx}"]`)?.addEventListener('click', () => {
          state.currentDay.wod.exercises[idx].sub_exercises.splice(sIdx, 1);
          renderWodExercisesList();
          triggerAutoSave(true);
        });

        row.querySelector(`[data-search-timed-sub-wod="${sIdx}"]`)?.addEventListener('click', () => {
          openExercisePicker({ type: 'timed_wod_sub_replace', idx, subIdx: sIdx }, false, sub.name);
        });

        row.querySelector(`[data-play-timed-sub-wod="${sIdx}"]`)?.addEventListener('click', () => {
          const curSub = state.currentDay.wod.exercises[idx].sub_exercises[sIdx];
          if (curSub?.video_url) {
            openVideoModal(curSub.name, curSub.video_url);
          } else {
            openExercisePicker({ type: 'timed_wod_sub_replace', idx, subIdx: sIdx }, false, curSub.name);
          }
        });

        row.querySelectorAll(`[data-timed-sub-wod-f][data-sub-idx="${sIdx}"]`).forEach((inp) => {
          const handleTimedSubInput = (isImmediate) => {
            state.currentDay.wod.exercises[idx].sub_exercises[sIdx][inp.dataset.timedSubWodF] = inp.value;
            if (inp.dataset.timedSubWodF === 'name') {
              const subRowEl = inp.closest('.sub-ex-coach-row');
              if (subRowEl) {
                tryAutoLinkExercise(state.currentDay.wod.exercises[idx].sub_exercises[sIdx], subRowEl, 'video_url');
              }
            }
            triggerAutoSave(isImmediate);
          };
          inp.addEventListener('input', () => handleTimedSubInput(false));
          inp.addEventListener('change', () => handleTimedSubInput(true));
          inp.addEventListener('blur', () => {
            if (inp.dataset.timedSubWodF === 'name') {
              const subRowEl = inp.closest('.sub-ex-coach-row');
              if (subRowEl) {
                tryAutoLinkExercise(state.currentDay.wod.exercises[idx].sub_exercises[sIdx], subRowEl, 'video_url');
              }
            }
          });
        });
      });

      list.appendChild(row);
      return;
    }

    if (item.is_sub_block) {
      wodBoxNum += 1;
      const row = renderSubBlockCoachBox(item, wodBoxNum, {
        showLoad: false,
        onDelete: () => {
          state.currentDay.wod.exercises.splice(idx, 1);
          renderWodExercisesList();
          triggerAutoSave(true);
        },
        onAddSub: () => {
          item.sub_exercises.push({ sets: '', reps: '10', name: '', video_url: '', notes: '' });
          renderWodExercisesList();
          triggerAutoSave(true);
        },
        onAddSubLib: () => openExercisePicker({ type: 'timed_wod_sub_add', idx }, false),
        onDelSub: (sIdx) => {
          item.sub_exercises.splice(sIdx, 1);
          renderWodExercisesList();
          triggerAutoSave(true);
        },
        onSearchSub: (sIdx) => openExercisePicker({ type: 'timed_wod_sub_replace', idx, subIdx: sIdx }, false),
        onPlaySub: (sIdx) => {
          const curSub = item.sub_exercises[sIdx];
          if (curSub && curSub.video_url) openVideoPreviewModal(curSub.name || 'Ejercicio', curSub.video_url, curSub.notes || '');
          else openExercisePicker({ type: 'timed_wod_sub_replace', idx, subIdx: sIdx }, false);
        },
      });
      list.appendChild(row);
      return;
    }

    const hasSubs = item.sub_exercises.length > 0;
    const row = document.createElement('div');
    row.className = 'ex-coach-line';
    if (hasSubs) {
      row.style.borderLeft = '3px solid #f59e0b';
      row.style.background = 'rgba(245,158,11,0.03)';
      row.style.paddingLeft = '10px';
    }

    let subHtml = '';
    item.sub_exercises.forEach((sub, subIdx) => {
      subHtml += `
        <div class="sub-ex-coach-row" style="margin-top:8px; padding-top:6px; border-top:1px dashed rgba(245,158,11,0.25); display:flex; flex-direction:column; gap:4px;">
          <div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; width:100%;">
            <div style="width:75px; flex-shrink:0; display:flex; align-items:center; justify-content:center;">
              <span class="badge" style="background:rgba(245,158,11,0.2); color:#f59e0b; font-weight:800; font-size:0.75rem; padding:4px 8px; width:100%; text-align:center;">+ ${subIdx + 2}</span>
            </div>
            <div style="width:85px; flex-shrink:0;">
              <input class="input" style="padding:6px; font-size:0.85rem;" data-sub-wod-f="reps" data-sub-idx="${subIdx}" placeholder="REPS" value="${esc(sub.reps || '')}" title="Repeticiones o Tiempo (ej: 10 / 30s)" />
            </div>
            <div style="flex:1; min-width:140px;">
              <input class="input" style="padding:6px; font-size:0.88rem; font-weight:700;" data-sub-wod-f="name" data-sub-idx="${subIdx}" list="libraryExercisesDatalist" placeholder="MOVE (ejercicio...)" value="${esc(sub.name || '')}" autocomplete="off" />
            </div>
            <div style="flex:1.2; min-width:160px; display:flex; align-items:center; gap:4px;">
              <input class="input" style="padding:6px; font-size:0.82rem; flex:1;" data-sub-wod-f="video_url" data-sub-idx="${subIdx}" placeholder="VIDEO (URL vídeo...)" value="${esc(sub.video_url || '')}" />
              <button class="btn btn-sm ${sub.video_url ? 'btn-primary' : 'btn-outline'}" type="button" data-play-sub-wod="${subIdx}" title="${sub.video_url ? 'Ver vídeo explicativo' : 'Buscar vídeo'}" style="padding:5px 8px; font-size:0.95rem;">🎬</button>
            </div>
            <div class="row-wrap" style="width:160px; justify-content:flex-end; gap:4px; flex-shrink:0;">
              <button class="btn btn-sm btn-outline" type="button" data-add-sub-wod="${idx}" title="Añadir otro ejercicio dentro de este bloque (+)" style="padding:6px 9px; font-weight:800; color:#f59e0b; border-color:rgba(245,158,11,0.4); font-size:1rem;">+</button>
              <button class="btn btn-sm btn-outline" type="button" data-search-sub-wod="${subIdx}" title="Buscar en biblioteca" style="padding:6px 8px;">🔍</button>
              <button class="btn btn-danger btn-sm" type="button" data-del-sub-wod="${subIdx}" title="Quitar este ejercicio" style="padding:6px 8px;">✕</button>
            </div>
          </div>
          <div>
            <input class="input" style="padding:3px 6px; font-size:0.8rem; color:var(--text-muted); background:transparent; border:none; border-bottom:1px dashed rgba(255,255,255,0.08);" data-sub-wod-f="notes" data-sub-idx="${subIdx}" placeholder="Notas de este ejercicio..." value="${esc(sub.notes || '')}" />
          </div>
        </div>
      `;
    });

    row.innerHTML = `
      <div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; width:100%;">
        <div style="width:75px; flex-shrink:0;">
          ${hasSubs 
            ? `<div style="display:flex; align-items:center; gap:4px;"><span class="badge" style="background:rgba(245,158,11,0.2); color:#f59e0b; font-weight:800; font-size:0.75rem; padding:4px 6px;">1</span><input class="input" style="padding:6px; font-size:0.85rem; width:100%;" data-wod-field="sets" placeholder="SETS" value="${esc(item.sets || '')}" title="SETS (Rondas o Series)" /></div>`
            : `<input class="input" style="padding:6px; font-size:0.85rem; width:100%;" data-wod-field="sets" placeholder="SETS" value="${esc(item.sets || '')}" title="SETS (Rondas o Series)" />`
          }
        </div>
        <div style="width:85px; flex-shrink:0;">
          <input class="input" style="padding:6px; font-size:0.85rem;" data-wod-field="reps" placeholder="REPS" value="${esc(item.reps || '')}" title="REPS (Repeticiones o Tiempo)" />
        </div>
        <div style="flex:1; min-width:140px;">
          <input class="input" style="padding:6px; font-size:0.88rem; font-weight:700;" data-wod-field="name" list="libraryExercisesDatalist" placeholder="${idx + 1}.- MOVE (nombre del ejercicio...)" value="${esc(item.name || '')}" autocomplete="off" />
        </div>
        <div style="flex:1.2; min-width:160px; display:flex; align-items:center; gap:4px;">
          <input class="input" style="padding:6px; font-size:0.82rem; flex:1;" data-wod-field="video_url" placeholder="VIDEO (URL vídeo YouTube...)" value="${esc(item.video_url || '')}" />
          <button class="btn btn-sm ${item.video_url ? 'btn-primary' : 'btn-outline'}" type="button" data-play-wod-ex="${idx}" title="${item.video_url ? 'Ver vídeo explicativo' : 'Buscar vídeo'}" style="padding:5px 8px; font-size:0.95rem;">🎬</button>
        </div>
        <div class="row-wrap" style="width:160px; justify-content:flex-end; gap:4px; flex-shrink:0;">
          <button class="btn btn-sm btn-outline" type="button" data-add-sub-wod="${idx}" title="Añadir otro ejercicio dentro de este bloque (+)" style="padding:6px 9px; font-weight:800; color:#f59e0b; border-color:rgba(245,158,11,0.4); font-size:1rem;">+</button>
          <button class="btn btn-sm btn-outline" type="button" data-search-wod-ex="${idx}" title="Buscar en biblioteca" style="padding:6px 8px;">🔍</button>
          <button class="btn btn-sm btn-outline" type="button" data-save-lib-wod-ex="${idx}" title="Guardar este ejercicio en la biblioteca" style="padding:6px 8px;">💾</button>
          <button class="btn btn-danger btn-sm" type="button" data-del-wod-ex="${idx}" title="Eliminar este ejercicio" style="padding:6px 8px;">✕</button>
        </div>
      </div>
      <div>
        <input class="input" style="padding:4px 6px; font-size:0.82rem; color:var(--text-muted); background:transparent; border:none; border-bottom:1px dashed rgba(255,255,255,0.08);" data-wod-field="notes" placeholder="Notas, peso Rx/Scaled o estrategia del ejercicio..." value="${esc(item.notes || '')}" />
      </div>
      ${subHtml}
    `;

    row.querySelector(`[data-del-wod-ex="${idx}"]`)?.addEventListener('click', () => {
      state.currentDay.wod.exercises.splice(idx, 1);
      renderWodExercisesList();
      triggerAutoSave(true);
    });

    row.querySelector(`[data-add-sub-wod="${idx}"]`)?.addEventListener('click', () => {
      if (!Array.isArray(state.currentDay.wod.exercises[idx].sub_exercises)) {
        state.currentDay.wod.exercises[idx].sub_exercises = [];
      }
      state.currentDay.wod.exercises[idx].sub_exercises.push({
        sets: '',
        reps: '10',
        name: '',
        video_url: '',
        notes: ''
      });
      renderWodExercisesList();
      triggerAutoSave(true);
    });

    row.querySelector(`[data-search-wod-ex="${idx}"]`)?.addEventListener('click', () => {
      openExercisePicker({ type: 'wod_replace', idx }, false, item.name);
    });

    row.querySelector(`[data-play-wod-ex="${idx}"]`)?.addEventListener('click', () => {
      const curItem = state.currentDay.wod.exercises[idx];
      if (curItem?.video_url) {
        openVideoModal(curItem.name, curItem.video_url);
      } else {
        openExercisePicker({ type: 'wod_replace', idx }, false, curItem.name);
      }
    });

    row.querySelector(`[data-save-lib-wod-ex="${idx}"]`)?.addEventListener('click', async () => {
      const curItem = state.currentDay.wod.exercises[idx];
      const ok = await saveExerciseToLibrary({
        name: curItem.name,
        video_url: curItem.video_url,
        notes: curItem.notes,
        category: 'WOD'
      });
      if (ok) renderWodExercisesList();
    });

    row.querySelectorAll('[data-wod-field]').forEach((inp) => {
      const handleWodInput = (isImmediate) => {
        state.currentDay.wod.exercises[idx][inp.dataset.wodField] = inp.value;
        if (inp.dataset.wodField === 'name') {
          tryAutoLinkExercise(state.currentDay.wod.exercises[idx], row, 'video_url');
        }
        triggerAutoSave(isImmediate);
      };
      inp.addEventListener('input', () => handleWodInput(false));
      inp.addEventListener('change', () => handleWodInput(true));
      inp.addEventListener('blur', () => {
        if (inp.dataset.wodField === 'name') {
          tryAutoLinkExercise(state.currentDay.wod.exercises[idx], row, 'video_url');
        }
      });
    });

    item.sub_exercises.forEach((sub, subIdx) => {
      row.querySelector(`[data-del-sub-wod="${subIdx}"]`)?.addEventListener('click', () => {
        state.currentDay.wod.exercises[idx].sub_exercises.splice(subIdx, 1);
        renderWodExercisesList();
        triggerAutoSave(true);
      });

      row.querySelector(`[data-search-sub-wod="${subIdx}"]`)?.addEventListener('click', () => {
        openExercisePicker({ type: 'wod_sub_replace', idx, subIdx }, false, sub.name);
      });

      row.querySelector(`[data-play-sub-wod="${subIdx}"]`)?.addEventListener('click', () => {
        const curSub = state.currentDay.wod.exercises[idx].sub_exercises[subIdx];
        if (curSub?.video_url) {
          openVideoModal(curSub.name, curSub.video_url);
        } else {
          openExercisePicker({ type: 'wod_sub_replace', idx, subIdx }, false, curSub.name);
        }
      });

      row.querySelectorAll(`[data-sub-wod-f][data-sub-idx="${subIdx}"]`).forEach((inp) => {
        const handleSubInput = (isImmediate) => {
          state.currentDay.wod.exercises[idx].sub_exercises[subIdx][inp.dataset.subWodF] = inp.value;
          if (inp.dataset.subWodF === 'name') {
            const subRowEl = inp.closest('.sub-ex-coach-row');
            if (subRowEl) {
              tryAutoLinkExercise(state.currentDay.wod.exercises[idx].sub_exercises[subIdx], subRowEl, 'video_url');
            }
          }
          triggerAutoSave(isImmediate);
        };
        inp.addEventListener('input', () => handleSubInput(false));
        inp.addEventListener('change', () => handleSubInput(true));
        inp.addEventListener('blur', () => {
          if (inp.dataset.subWodF === 'name') {
            const subRowEl = inp.closest('.sub-ex-coach-row');
            if (subRowEl) {
              tryAutoLinkExercise(state.currentDay.wod.exercises[idx].sub_exercises[subIdx], subRowEl, 'video_url');
            }
          }
        });
      });
    });

    list.appendChild(row);
  });
}

// Fallback compatibility alias
function renderWodMovementsList() {
  renderWodExercisesList();
}

$('btnAddWodExercise')?.addEventListener('click', () => {
  if (!state.currentDay) {
    showToast('Selecciona primero un día en la planificación.');
    return;
  }
  if (!state.currentDay.wod) state.currentDay.wod = {};
  if (!Array.isArray(state.currentDay.wod.exercises)) state.currentDay.wod.exercises = [];
  state.currentDay.wod.exercises.push({
    sets: '',
    reps: '10',
    name: '',
    video_url: '',
    notes: '',
    sub_exercises: []
  });
  renderWodExercisesList();
  triggerAutoSave(true);
});

$('btnAddWodExerciseLib')?.addEventListener('click', () => {
  if (!state.currentDay) {
    showToast('Selecciona primero un día en la planificación.');
    return;
  }
  openExercisePicker({ type: 'wod_add' }, false);
});

$('btnAddWodSubBlock')?.addEventListener('click', () => {
  if (!state.currentDay) {
    showToast('Selecciona primero un día en la planificación.');
    return;
  }
  if (!state.currentDay.wod) state.currentDay.wod = {};
  if (!Array.isArray(state.currentDay.wod.exercises)) state.currentDay.wod.exercises = [];
  state.currentDay.wod.exercises.push(createSubBlockItem(''));
  renderWodExercisesList();
  triggerAutoSave(true);
  showToast('📦 Cuadro añadido al WOD');
});

$('btnAddWodTimedSection')?.addEventListener('click', () => {
  if (!state.currentDay) {
    showToast('Selecciona primero un día en la planificación.');
    return;
  }
  if (!state.currentDay.wod) state.currentDay.wod = {};
  if (!Array.isArray(state.currentDay.wod.exercises)) state.currentDay.wod.exercises = [];
  state.currentDay.wod.exercises.push({
    is_timed_section: true,
    timer_type: 'AMRAP',
    timer_minutes: 10,
    name: 'AMRAP (10 min)',
    notes: '',
    sub_exercises: []
  });
  renderWodExercisesList();
  triggerAutoSave(true);
});

$('btnAddWodMovementLib')?.addEventListener('click', () => {
  if (!state.currentDay) return;
  openExercisePicker({ type: 'wod_add' }, false);
});

$('btnAddWodMovementManual')?.addEventListener('click', () => {
  if (!state.currentDay) return;
  if (!state.currentDay.wod) state.currentDay.wod = {};
  if (!Array.isArray(state.currentDay.wod.exercises)) state.currentDay.wod.exercises = [];
  state.currentDay.wod.exercises.push({ sets: '', reps: '10', name: '', notes: '', video_url: '', sub_exercises: [] });
  renderWodExercisesList();
  triggerAutoSave(true);
});

$('btnAddWarmupLine')?.addEventListener('click', () => {
  if (!state.currentDay) {
    showToast('Selecciona primero un día en la planificación.');
    return;
  }
  if (!Array.isArray(state.currentDay.warmup_exercises)) state.currentDay.warmup_exercises = [];
  state.currentDay.warmup_exercises.push({
    name: '',
    sets: '3 rondas',
    reps: '10',
    notes: '',
    video_url: '',
    sub_exercises: [],
  });
  renderWarmupList();
  triggerAutoSave(true);
});
$('btnAddWarmupSubBlock')?.addEventListener('click', () => {
  if (!state.currentDay) {
    showToast('Selecciona primero un día en la planificación.');
    return;
  }
  if (!Array.isArray(state.currentDay.warmup_exercises)) state.currentDay.warmup_exercises = [];
  state.currentDay.warmup_exercises.push(createSubBlockItem(''));
  renderWarmupList();
  triggerAutoSave(true);
  showToast('📦 Cuadro añadido al Calentamiento');
});

$('btnAddWarmupTimedBlock')?.addEventListener('click', () => {
  if (!state.currentDay) {
    showToast('Selecciona primero un día en la planificación.');
    return;
  }
  if (!Array.isArray(state.currentDay.warmup_exercises)) state.currentDay.warmup_exercises = [];
  state.currentDay.warmup_exercises.push(createTimedSectionItem('AMRAP', 10));
  renderWarmupList();
  triggerAutoSave(true);
  showToast('⏱ AMRAP añadido al calentamiento');
});
$('btnAddWarmupAny')?.addEventListener('click', async () => {
  if (!state.currentDay) {
    showToast('Selecciona primero un día en la planificación.');
    return;
  }
  await openExercisePicker({ type: 'warmup' }, false);
});
$('btnAddPart')?.addEventListener('click', () => {
  if (!state.currentDay) return;
  const idx = (state.currentDay.parts || []).length;
  state.currentDay.parts.push({
    part_label: `BLOQUE ${idx + 1}`,
    title: '',
    type: 'Fuerza',
    description: '',
    exercises: [],
  });
  renderPartsList();
  triggerAutoSave(true);
});

$('btnCoachPrintDay')?.addEventListener('click', async () => {
  if (!state.currentDay) {
    alert('Selecciona un día en la planificación primero.');
    return;
  }
  await doAutoSave();
  window.open(`/alumnos#day=${state.currentDay.id}`, '_blank');
});

// Exercise picker & target insertion
function pickExerciseIntoTarget(ex) {
  if (!state.pickerTarget || !state.currentDay) return;
  if (state.pickerTarget.type === 'warmup_replace') {
    const cur = (state.currentDay.warmup_exercises || [])[state.pickerTarget.idx];
    if (cur) {
      cur.name = ex.name;
      cur.video_url = ex.video_url || '';
      if (!cur.notes && (ex.coaching_cues || ex.description)) {
        cur.notes = ex.coaching_cues || ex.description;
      }
      renderWarmupList();
      triggerAutoSave(true);
      showToast(`✓ Ejercicio enlazado: "${ex.name}"`);
    }
    return;
  }
  if (state.pickerTarget.type === 'warmup_sub_replace') {
    const parent = (state.currentDay.warmup_exercises || [])[state.pickerTarget.idx];
    if (parent && Array.isArray(parent.sub_exercises) && parent.sub_exercises[state.pickerTarget.subIdx]) {
      const cur = parent.sub_exercises[state.pickerTarget.subIdx];
      cur.name = ex.name;
      cur.video_url = ex.video_url || '';
      if (!cur.notes && (ex.coaching_cues || ex.description)) {
        cur.notes = ex.coaching_cues || ex.description;
      }
      renderWarmupList();
      triggerAutoSave(true);
      showToast(`✓ Ejercicio enlazado: "${ex.name}"`);
    }
    return;
  }
  if (state.pickerTarget.type === 'part_replace') {
    const part = (state.currentDay.parts || [])[state.pickerTarget.partIdx];
    if (part && Array.isArray(part.exercises) && part.exercises[state.pickerTarget.exIdx]) {
      const cur = part.exercises[state.pickerTarget.exIdx];
      cur.name = ex.name;
      cur.video_url = ex.video_url || '';
      if (!cur.notes && (ex.coaching_cues || ex.description)) {
        cur.notes = ex.coaching_cues || ex.description;
      }
      renderPartsList();
      triggerAutoSave(true);
      showToast(`✓ Ejercicio de bloque enlazado: "${ex.name}"`);
    }
    return;
  }
  if (state.pickerTarget.type === 'part_sub_replace') {
    const part = (state.currentDay.parts || [])[state.pickerTarget.partIdx];
    if (part && Array.isArray(part.exercises) && part.exercises[state.pickerTarget.exIdx]) {
      const parent = part.exercises[state.pickerTarget.exIdx];
      if (Array.isArray(parent.sub_exercises) && parent.sub_exercises[state.pickerTarget.subIdx]) {
        const cur = parent.sub_exercises[state.pickerTarget.subIdx];
        cur.name = ex.name;
        cur.video_url = ex.video_url || '';
        if (!cur.notes && (ex.coaching_cues || ex.description)) {
          cur.notes = ex.coaching_cues || ex.description;
        }
        renderPartsList();
        triggerAutoSave(true);
        showToast(`✓ Ejercicio de bloque enlazado: "${ex.name}"`);
      }
    }
    return;
  }
  if (state.pickerTarget.type === 'timed_wu_sub_add') {
    const parent = (state.currentDay.warmup_exercises || [])[state.pickerTarget.idx];
    if (parent) {
      if (!Array.isArray(parent.sub_exercises)) parent.sub_exercises = [];
      parent.sub_exercises.push({
        sets: '',
        reps: '10',
        name: ex.name,
        video_url: ex.video_url || '',
        notes: ex.coaching_cues || ex.description || '',
      });
      renderWarmupList();
      triggerAutoSave(true);
      showToast(`✓ "${ex.name}" añadido al bloque con crono`);
    }
    return;
  }
  if (state.pickerTarget.type === 'timed_wu_sub_replace') {
    const parent = (state.currentDay.warmup_exercises || [])[state.pickerTarget.idx];
    if (parent && Array.isArray(parent.sub_exercises) && parent.sub_exercises[state.pickerTarget.subIdx]) {
      const cur = parent.sub_exercises[state.pickerTarget.subIdx];
      cur.name = ex.name;
      cur.video_url = ex.video_url || '';
      if (!cur.notes && (ex.coaching_cues || ex.description)) {
        cur.notes = ex.coaching_cues || ex.description;
      }
      renderWarmupList();
      triggerAutoSave(true);
      showToast(`✓ Ejercicio enlazado: "${ex.name}"`);
    }
    return;
  }
  if (state.pickerTarget.type === 'timed_part_sub_add') {
    const part = (state.currentDay.parts || [])[state.pickerTarget.partIdx];
    if (part && Array.isArray(part.exercises) && part.exercises[state.pickerTarget.exIdx]) {
      const parent = part.exercises[state.pickerTarget.exIdx];
      if (!Array.isArray(parent.sub_exercises)) parent.sub_exercises = [];
      parent.sub_exercises.push({
        sets: '',
        reps: '10',
        load: '',
        name: ex.name,
        video_url: ex.video_url || '',
        notes: ex.coaching_cues || ex.description || '',
      });
      renderPartsList();
      triggerAutoSave(true);
      showToast(`✓ "${ex.name}" añadido al bloque con crono`);
    }
    return;
  }
  if (state.pickerTarget.type === 'timed_part_sub_replace') {
    const part = (state.currentDay.parts || [])[state.pickerTarget.partIdx];
    if (part && Array.isArray(part.exercises) && part.exercises[state.pickerTarget.exIdx]) {
      const parent = part.exercises[state.pickerTarget.exIdx];
      if (Array.isArray(parent.sub_exercises) && parent.sub_exercises[state.pickerTarget.subIdx]) {
        const cur = parent.sub_exercises[state.pickerTarget.subIdx];
        cur.name = ex.name;
        cur.video_url = ex.video_url || '';
        if (!cur.notes && (ex.coaching_cues || ex.description)) {
          cur.notes = ex.coaching_cues || ex.description;
        }
        renderPartsList();
        triggerAutoSave(true);
        showToast(`✓ Ejercicio enlazado: "${ex.name}"`);
      }
    }
    return;
  }
  if (state.pickerTarget.type === 'wod_replace') {
    const cur = (state.currentDay.wod?.exercises || [])[state.pickerTarget.idx];
    if (cur) {
      cur.name = ex.name;
      cur.video_url = ex.video_url || '';
      if (!cur.notes && (ex.coaching_cues || ex.description)) {
        cur.notes = ex.coaching_cues || ex.description;
      }
      renderWodExercisesList();
      triggerAutoSave(true);
      showToast(`✓ Ejercicio de WOD enlazado: "${ex.name}"`);
    }
    return;
  }
  if (state.pickerTarget.type === 'wod_sub_replace') {
    const parent = (state.currentDay.wod?.exercises || [])[state.pickerTarget.idx];
    if (parent && Array.isArray(parent.sub_exercises) && parent.sub_exercises[state.pickerTarget.subIdx]) {
      const cur = parent.sub_exercises[state.pickerTarget.subIdx];
      cur.name = ex.name;
      cur.video_url = ex.video_url || '';
      if (!cur.notes && (ex.coaching_cues || ex.description)) {
        cur.notes = ex.coaching_cues || ex.description;
      }
      renderWodExercisesList();
      triggerAutoSave(true);
      showToast(`✓ Ejercicio de WOD enlazado: "${ex.name}"`);
    }
    return;
  }
  if (state.pickerTarget.type === 'timed_wod_sub_add') {
    const parent = (state.currentDay.wod?.exercises || [])[state.pickerTarget.idx];
    if (parent) {
      if (!Array.isArray(parent.sub_exercises)) parent.sub_exercises = [];
      parent.sub_exercises.push({
        sets: '',
        reps: '10',
        name: ex.name,
        video_url: ex.video_url || '',
        notes: ex.coaching_cues || ex.description || ''
      });
      renderWodExercisesList();
      triggerAutoSave(true);
      showToast(`✓ "${ex.name}" añadido al ${parent.timer_type || 'WOD'}`);
    }
    return;
  }
  if (state.pickerTarget.type === 'timed_wod_sub_replace') {
    const parent = (state.currentDay.wod?.exercises || [])[state.pickerTarget.idx];
    if (parent && Array.isArray(parent.sub_exercises) && parent.sub_exercises[state.pickerTarget.subIdx]) {
      const cur = parent.sub_exercises[state.pickerTarget.subIdx];
      cur.name = ex.name;
      cur.video_url = ex.video_url || '';
      if (!cur.notes && (ex.coaching_cues || ex.description)) {
        cur.notes = ex.coaching_cues || ex.description;
      }
      renderWodExercisesList();
      triggerAutoSave(true);
      showToast(`✓ Ejercicio enlazado: "${ex.name}"`);
    }
    return;
  }
  if (state.pickerTarget.type === 'warmup') {
    if (!Array.isArray(state.currentDay.warmup_exercises)) state.currentDay.warmup_exercises = [];
    state.currentDay.warmup_exercises.push({
      name: ex.name,
      sets: '3 rondas',
      reps: '10',
      notes: ex.coaching_cues || ex.description || '',
      video_url: ex.video_url || '',
      sub_exercises: [],
    });
    renderWarmupList();
    triggerAutoSave(true);
    showToast(`✓ "${ex.name}" añadido al Warm Up`);
  } else if (state.pickerTarget.type === 'wod' || state.pickerTarget.type === 'wod_add') {
    if (!state.currentDay.wod) state.currentDay.wod = {};
    if (!Array.isArray(state.currentDay.wod.exercises)) state.currentDay.wod.exercises = [];
    state.currentDay.wod.exercises.push({
      name: ex.name,
      sets: '',
      reps: '10',
      notes: ex.coaching_cues || ex.description || '',
      video_url: ex.video_url || '',
      sub_exercises: [],
    });
    renderWodExercisesList();
    triggerAutoSave(true);
    showToast(`✓ Ejercicio añadido al WOD Final: "${ex.name}"`);
  } else if (state.pickerTarget.type === 'part') {
    const part = state.currentDay.parts[state.pickerTarget.partIdx];
    if (part) {
      if (!Array.isArray(part.exercises)) part.exercises = [];
      part.exercises.push({
        name: ex.name,
        sets: '4',
        reps: '6-8',
        load: '75% 1RM',
        rest: '90 seg',
        notes: ex.coaching_cues || ex.description || '',
        video_url: ex.video_url || '',
        sub_exercises: [],
      });
      renderPartsList();
      triggerAutoSave(true);
      showToast(`✓ Ejercicio añadido al Bloque: "${ex.name}"`);
    }
  }
}

async function openExercisePicker(target, groundOnly = false, searchInitial = '') {
  state.pickerTarget = target;
  state.pickerGroundOnly = groundOnly;
  if (!Array.isArray(state.exercises) || state.exercises.length === 0) {
    try {
      state.exercises = await api('/api/exercises');
      populateExercisesDatalist();
    } catch (_) {}
  }
  const title = $('pickerTitle');
  if (title) title.textContent = '📚 Biblioteca de Ejercicios';
  const groundToggle = $('pickerGroundToggle');
  if (groundToggle) groundToggle.classList.add('hidden');
  const searchInp = $('pickerSearch');
  if (searchInp) searchInp.value = searchInitial || '';
  renderPickerList();
  openModal('pickerModal');
}

$('btnPickerAddNewEx')?.addEventListener('click', () => {
  const query = $('pickerSearch').value.trim();
  openExerciseModal(null);
  if (query) $('exName').value = query;
  if (state.pickerGroundOnly) {
    $('exIsGround').checked = true;
    $('exLevel').disabled = false;
  }
});

$('pickerGroundToggle')?.addEventListener('click', () => {
  state.pickerGroundOnly = !state.pickerGroundOnly;
  $('pickerGroundToggle').classList.toggle('selected', state.pickerGroundOnly);
  renderPickerList();
});
$('pickerSearch')?.addEventListener('input', renderPickerList);

function renderPickerList() {
  const q = $('pickerSearch').value.trim().toLowerCase();
  const list = $('pickerList');
  const filtered = state.exercises.filter((ex) => {
    if (state.pickerGroundOnly && !ex.is_ground) return false;
    if (q && !ex.name.toLowerCase().includes(q) && !(ex.description || '').toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
  list.innerHTML = '';
  if (filtered.length === 0) {
    list.innerHTML = '<p class="muted">No se encontraron ejercicios con ese filtro. Usa "+ Crear nuevo" arriba para añadirlo a la biblioteca.</p>';
    return;
  }
  filtered.forEach((ex) => {
    const row = document.createElement('div');
    row.className = 'item-box';
    row.innerHTML = `
      <div class="row-between">
        <div>
          <strong>${esc(ex.name)}</strong>
          <div class="row-wrap" style="margin-top:4px;">
            ${ex.is_ground ? `<span class="badge badge-ground">GROUND · ${esc(ex.ground_flow_level)}</span>` : `<span class="badge">${esc(ex.category)}</span>`}
          </div>
        </div>
        <div class="row-wrap">
          ${ex.video_url ? `<button class="btn btn-sm" data-preview>▶</button>` : ''}
          <button class="btn btn-primary btn-sm" data-pick>Añadir</button>
        </div>
      </div>
    `;
    row.querySelector('[data-preview]')?.addEventListener('click', () => openVideoModal(ex.name, ex.video_url));
    row.querySelector('[data-pick]').addEventListener('click', () => {
      pickExerciseIntoTarget(ex);
      closeModal('pickerModal');
    });
    list.appendChild(row);
  });
}

// WOD Generator
function renderEquipmentChips() {
  const wrap = $('genEquipmentChips');
  wrap.innerHTML = '';
  EQUIPMENT_LIST.forEach((eq) => {
    const chip = document.createElement('span');
    chip.className = `chip ${state.selectedEquipment.has(eq) ? 'selected' : ''}`;
    chip.textContent = eq;
    chip.addEventListener('click', () => {
      if (state.selectedEquipment.has(eq)) state.selectedEquipment.delete(eq);
      else state.selectedEquipment.add(eq);
      renderEquipmentChips();
    });
    wrap.appendChild(chip);
  });
}

function getSkillsList() {
  let custom = [];
  try {
    custom = JSON.parse(localStorage.getItem('hecthor_custom_skills') || '[]');
  } catch (_) {}
  const all = [...DEFAULT_SKILLS];
  custom.forEach((s) => {
    if (s && !all.includes(s)) all.push(s);
  });
  return all;
}

function renderSkillsChips() {
  const wrap = $('genSkillsChips');
  if (!wrap) return;
  wrap.innerHTML = '';
  const skills = getSkillsList();
  skills.forEach((skill) => {
    const chip = document.createElement('span');
    chip.className = `chip ${state.selectedSkills && state.selectedSkills.has(skill) ? 'selected' : ''}`;
    chip.textContent = skill;
    chip.addEventListener('click', () => {
      if (!state.selectedSkills) state.selectedSkills = new Set();
      if (state.selectedSkills.has(skill)) state.selectedSkills.delete(skill);
      else state.selectedSkills.add(skill);
      renderSkillsChips();
    });
    wrap.appendChild(chip);
  });
}

function addCustomSkill() {
  const val = ($('newSkillInput')?.value || '').trim();
  if (!val) return;
  try {
    const saved = JSON.parse(localStorage.getItem('hecthor_custom_skills') || '[]');
    if (!saved.includes(val)) {
      saved.push(val);
      localStorage.setItem('hecthor_custom_skills', JSON.stringify(saved));
    }
  } catch (_) {}
  if (!state.selectedSkills) state.selectedSkills = new Set();
  state.selectedSkills.add(val);
  if ($('newSkillInput')) $('newSkillInput').value = '';
  $('newSkillInputBox')?.classList.add('hidden');
  renderSkillsChips();
}

function loadCustomWodTypes() {
  try {
    const saved = JSON.parse(localStorage.getItem('hecthor_custom_wod_types') || '[]');
    const sel = $('genWodType');
    const dl = $('wodTypeList');
    if (!sel) return;
    const existing = new Set(Array.from(sel.options).map((o) => o.value));
    saved.forEach((t) => {
      if (!existing.has(t)) {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        const newMarker = sel.querySelector('option[value="__new__"]');
        if (newMarker) sel.insertBefore(opt, newMarker);
        else sel.appendChild(opt);
      }
      if (dl && !Array.from(dl.options).some((o) => o.value === t)) {
        const dlOpt = document.createElement('option');
        dlOpt.value = t;
        dl.appendChild(dlOpt);
      }
    });
  } catch (_) {}
}

$('genWodType')?.addEventListener('change', (e) => {
  if (e.target.value === '__new__') {
    $('newWodTypeBox')?.classList.remove('hidden');
    $('newWodTypeInput')?.focus();
  } else {
    $('newWodTypeBox')?.classList.add('hidden');
  }
});
$('btnNewWodType')?.addEventListener('click', () => {
  $('newWodTypeBox')?.classList.toggle('hidden');
  if (!$('newWodTypeBox')?.classList.contains('hidden')) {
    $('newWodTypeInput')?.focus();
  }
});
function addCustomWodType() {
  const val = ($('newWodTypeInput')?.value || '').trim().toUpperCase();
  if (!val) return;
  const sel = $('genWodType');
  const dl = $('wodTypeList');
  if (sel) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    const newMarker = sel.querySelector('option[value="__new__"]');
    if (newMarker) sel.insertBefore(opt, newMarker);
    else sel.appendChild(opt);
    sel.value = val;
  }
  if (dl && !Array.from(dl.options).some((o) => o.value === val)) {
    const dlOpt = document.createElement('option');
    dlOpt.value = val;
    dl.appendChild(dlOpt);
  }
  if ($('newWodTypeInput')) $('newWodTypeInput').value = '';
  $('newWodTypeBox')?.classList.add('hidden');
  try {
    const saved = JSON.parse(localStorage.getItem('hecthor_custom_wod_types') || '[]');
    if (!saved.includes(val)) {
      saved.push(val);
      localStorage.setItem('hecthor_custom_wod_types', JSON.stringify(saved));
    }
  } catch (_) {}
}
$('btnSaveWodType')?.addEventListener('click', addCustomWodType);
$('newWodTypeInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addCustomWodType();
  }
});

// ================= COACH CRONO PRO MODAL =================
function openCoachCronoProModal(spec) {
  const modal = $('cronoProModal');
  const iframe = $('cronoProIframe');
  const newTabBtn = $('cronoProNewTabBtn');
  if (modal && iframe) {
    let url = '/crono/';
    if (spec) {
      const p = new URLSearchParams();
      if (spec.mode) p.set('mode', spec.mode);
      if (spec.workSec !== undefined) p.set('work', spec.workSec);
      if (spec.restSec !== undefined) p.set('rest', spec.restSec);
      if (spec.tabataRounds !== undefined) p.set('rounds', spec.tabataRounds);
      if (spec.minutes !== undefined) p.set('time', spec.minutes);
      if (spec.intervalSec !== undefined) p.set('interval', spec.intervalSec);
      url += `?${p.toString()}`;
    }
    iframe.src = url;
    if (newTabBtn) newTabBtn.href = url;
    modal.classList.add('open');
  }
}

$('btnCloseCronoPro')?.addEventListener('click', () => {
  const modal = $('cronoProModal');
  const iframe = $('cronoProIframe');
  if (modal && iframe) {
    modal.classList.remove('open');
    iframe.src = 'about:blank';
  }
});

// ================= COACH WARM UP TIMER CONTROLS =================
function updateWarmupTimerUI() {
  const raw = ($('warmupTimerType')?.value || 'AMRAP').toUpperCase();
  const isSin = raw.includes('SIN CRONO');
  const isTabata = !isSin && raw.includes('TABATA');
  const isEmom = !isSin && raw.includes('EMOM');
  const isCap = !isSin && (raw.includes('AMRAP') || raw.includes('FOR TIME') || raw.includes('TIME') || raw.includes('CRONO'));

  $('warmupTimerConfigCard')?.classList.toggle('hidden', isSin);
  $('warmupCfgTabata')?.classList.toggle('hidden', !isTabata);
  $('warmupCfgEmom')?.classList.toggle('hidden', !isEmom);
  $('warmupCfgCap')?.classList.toggle('hidden', !isCap);

  const sumEl = $('warmupTimerSummary');
  if (isSin) {
    if (sumEl) sumEl.textContent = 'Sin crono configurado para el Warm Up';
  } else if (isTabata) {
    const w = Number($('warmupTabataWork')?.value) || 20;
    const r = $('warmupTabataRest') && $('warmupTabataRest').value !== '' ? Number($('warmupTabataRest').value) : 10;
    const rounds = Number($('warmupTabataRounds')?.value) || 8;
    const totalSec = (w + r) * rounds;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const tStr = s > 0 ? `${m}m ${s}s` : `${m} min`;
    if (sumEl) sumEl.innerHTML = `⚡ <strong>${rounds} rondas</strong>: <span style="color:#38bdf8; font-weight:800;">${w}s Trabajo (Azul)</span> / <span style="color:#22c55e; font-weight:800;">${r}s Descanso (Verde)</span> (Total: ${tStr})`;
    if ($('warmupTimerMinutes')) $('warmupTimerMinutes').value = Math.ceil(totalSec / 60);
  } else if (isEmom) {
    const intSec = Number($('warmupEmomInterval')?.value) || 60;
    const rounds = Number($('warmupEmomRounds')?.value) || 8;
    const totalM = Math.round((intSec * rounds) / 60);
    if (sumEl) sumEl.innerHTML = `⚡ <strong>EMOM</strong>: Cada ${intSec}s durante ${rounds} rondas (Total: ${totalM} min)`;
    if ($('warmupTimerMinutes')) $('warmupTimerMinutes').value = totalM;
  } else if (isCap) {
    const mins = Number($('warmupTimerMinutes')?.value) || 8;
    if (sumEl) sumEl.innerHTML = `⚡ Duración / Cap: <strong>${mins} minutos</strong>`;
  }
}

function initCoachWarmupTimerControls() {
  $('warmupTimerType')?.addEventListener('change', updateWarmupTimerUI);

  // Tabata coach steppers for Warm Up
  $('btnCoachDecWarmupWork')?.addEventListener('click', () => {
    const cur = Number($('warmupTabataWork')?.value) || 20;
    if ($('warmupTabataWork')) $('warmupTabataWork').value = Math.max(5, cur - 5);
    updateWarmupTimerUI();
  });
  $('btnCoachIncWarmupWork')?.addEventListener('click', () => {
    const cur = Number($('warmupTabataWork')?.value) || 20;
    if ($('warmupTabataWork')) $('warmupTabataWork').value = cur + 5;
    updateWarmupTimerUI();
  });
  $('btnCoachDecWarmupRest')?.addEventListener('click', () => {
    const cur = $('warmupTabataRest') && $('warmupTabataRest').value !== '' ? Number($('warmupTabataRest').value) : 10;
    if ($('warmupTabataRest')) $('warmupTabataRest').value = Math.max(0, cur - 5);
    updateWarmupTimerUI();
  });
  $('btnCoachIncWarmupRest')?.addEventListener('click', () => {
    const cur = $('warmupTabataRest') && $('warmupTabataRest').value !== '' ? Number($('warmupTabataRest').value) : 10;
    if ($('warmupTabataRest')) $('warmupTabataRest').value = cur + 5;
    updateWarmupTimerUI();
  });
  $('btnCoachDecWarmupRounds')?.addEventListener('click', () => {
    const cur = Number($('warmupTabataRounds')?.value) || 8;
    if ($('warmupTabataRounds')) $('warmupTabataRounds').value = Math.max(1, cur - 1);
    updateWarmupTimerUI();
  });
  $('btnCoachIncWarmupRounds')?.addEventListener('click', () => {
    const cur = Number($('warmupTabataRounds')?.value) || 8;
    if ($('warmupTabataRounds')) $('warmupTabataRounds').value = Math.min(50, cur + 1);
    updateWarmupTimerUI();
  });

  // EMOM steppers for Warm Up
  $('btnCoachDecWarmupEmomInt')?.addEventListener('click', () => {
    const cur = Number($('warmupEmomInterval')?.value) || 60;
    if ($('warmupEmomInterval')) $('warmupEmomInterval').value = Math.max(10, cur - 15);
    updateWarmupTimerUI();
  });
  $('btnCoachIncWarmupEmomInt')?.addEventListener('click', () => {
    const cur = Number($('warmupEmomInterval')?.value) || 60;
    if ($('warmupEmomInterval')) $('warmupEmomInterval').value = Math.min(600, cur + 15);
    updateWarmupTimerUI();
  });
  $('btnCoachDecWarmupEmomRounds')?.addEventListener('click', () => {
    const cur = Number($('warmupEmomRounds')?.value) || 8;
    if ($('warmupEmomRounds')) $('warmupEmomRounds').value = Math.max(1, cur - 1);
    updateWarmupTimerUI();
  });
  $('btnCoachIncWarmupEmomRounds')?.addEventListener('click', () => {
    const cur = Number($('warmupEmomRounds')?.value) || 8;
    if ($('warmupEmomRounds')) $('warmupEmomRounds').value = Math.min(60, cur + 1);
    updateWarmupTimerUI();
  });

  // Mins steppers for Warm Up
  $('btnCoachDecWarmupMins')?.addEventListener('click', () => {
    const cur = Number($('warmupTimerMinutes')?.value) || 8;
    if ($('warmupTimerMinutes')) $('warmupTimerMinutes').value = Math.max(1, cur - 1);
    updateWarmupTimerUI();
  });
  $('btnCoachIncWarmupMins')?.addEventListener('click', () => {
    const cur = Number($('warmupTimerMinutes')?.value) || 8;
    if ($('warmupTimerMinutes')) $('warmupTimerMinutes').value = Math.min(60, cur + 1);
    updateWarmupTimerUI();
  });

  ['warmupTabataWork', 'warmupTabataRest', 'warmupTabataRounds', 'warmupEmomInterval', 'warmupEmomRounds', 'warmupTimerMinutes'].forEach((id) => {
    $(id)?.addEventListener('input', updateWarmupTimerUI);
    $(id)?.addEventListener('change', updateWarmupTimerUI);
  });

  // Launch Crono Pro for Warm Up
  $('btnLaunchWarmupCronoPro')?.addEventListener('click', () => {
    const raw = ($('warmupTimerType')?.value || 'AMRAP').toUpperCase();
    if (raw.includes('SIN CRONO')) {
      return showToast('Elige un formato de crono para el Warm Up');
    }
    const mode = raw.includes('TABATA') ? 'TABATA' : (raw.includes('EMOM') ? 'EMOM' : (raw.includes('TIME') ? 'FOR TIME' : 'AMRAP'));
    const spec = {
      mode,
      minutes: Number($('warmupTimerMinutes')?.value) || 8,
      workSec: Number($('warmupTabataWork')?.value) || 20,
      restSec: Number($('warmupTabataRest')?.value) || 10,
      tabataRounds: Number($('warmupTabataRounds')?.value) || 8,
      intervalSec: Number($('warmupEmomInterval')?.value) || 60,
    };
    openCoachCronoProModal(spec);
  });
}
initCoachWarmupTimerControls();

// ================= COACH WOD TIMER CONTROLS =================
function updateWodTimerUI() {
  const rawType = ($('wodType')?.value || '').toUpperCase();
  const isSin = rawType.includes('SIN CRONO');
  const isTabata = !isSin && rawType.includes('TABATA');
  const isEmom = !isSin && rawType.includes('EMOM');
  const isCap = !isSin && (rawType.includes('AMRAP') || rawType.includes('FOR TIME') || rawType.includes('TIME') || rawType.includes('CHIPPER') || rawType.includes('ENDURANCE'));

  $('wodTimerConfigCard')?.classList.toggle('hidden', isSin);
  $('wodCfgTabata')?.classList.toggle('hidden', !isTabata);
  $('wodCfgEmom')?.classList.toggle('hidden', !isEmom);
  $('wodCfgCap')?.classList.toggle('hidden', !isCap);

  const sumEl = $('wodTimerSummary');
  const hasCapChecked = $('wodHasTimeCap') ? $('wodHasTimeCap').checked : Boolean($('wodTimeCap')?.value);
  if ($('wodTimeCap')) {
    $('wodTimeCap').disabled = !hasCapChecked;
    if (!hasCapChecked && !$('wodTimeCap').dataset.manualEdited) {
      $('wodTimeCap').value = '';
    }
  }

  if (isSin) {
    if (sumEl) sumEl.textContent = 'Sin crono configurado para el WOD';
  } else if (isTabata) {
    const work = Number($('wodTabataWork')?.value) || 20;
    const rest = $('wodTabataRest') && $('wodTabataRest').value !== '' ? Number($('wodTabataRest').value) : 10;
    const rounds = Number($('wodTabataRounds')?.value) || 8;
    const totalSec = (work + rest) * rounds;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const tStr = s > 0 ? `${m}m ${s}s` : `${m} min`;
    if (sumEl) sumEl.innerHTML = `⚡ <strong>${rounds} rondas</strong>: <span style="color:#38bdf8; font-weight:800;">${work}s Trabajo (Azul)</span> / <span style="color:#22c55e; font-weight:800;">${rest}s Descanso (Verde)</span> (Total: ${tStr})`;
    if (hasCapChecked && $('wodTimeCap') && !$('wodTimeCap').dataset.manualEdited) {
      $('wodTimeCap').value = `${rounds} rondas · ${work}s/${rest}s (${tStr})`;
    }
  } else if (isEmom) {
    const intSec = Number($('wodEmomInterval')?.value) || 60;
    const rounds = Number($('wodEmomRounds')?.value) || 10;
    const totalM = Math.round((intSec * rounds) / 60);
    if (sumEl) sumEl.innerHTML = `⚡ <strong>EMOM</strong>: Cada ${intSec}s durante ${rounds} intervalos (Total: ${totalM} min)`;
    if (hasCapChecked && $('wodTimeCap') && !$('wodTimeCap').dataset.manualEdited) {
      $('wodTimeCap').value = `EMOM ${rounds}' (cada ${intSec}s)`;
    }
  } else if (isCap) {
    const mins = Number($('wodMinutes')?.value) || 12;
    if (sumEl) sumEl.innerHTML = `⚡ Duración / Time Cap: <strong>${mins} minutos</strong>`;
    if (hasCapChecked && $('wodTimeCap') && !$('wodTimeCap').dataset.manualEdited) {
      $('wodTimeCap').value = `${mins} Minutos`;
    }
  } else {
    if (sumEl) sumEl.textContent = 'Configura el formato de entrenamiento';
  }
}

function initCoachWodTimerControls() {
  const updateScoreTypeSuggestion = () => {
    const rawType = ($('wodType')?.value || '').toUpperCase();
    if ($('wodScoreType') && !$('wodScoreType').dataset.manualEdited) {
      if (rawType.includes('TIME') || rawType.includes('CHIPPER')) {
        $('wodScoreType').value = 'TIEMPO';
      } else if (rawType.includes('AMRAP')) {
        $('wodScoreType').value = 'RONDAS + REPS';
      } else if (rawType.includes('EMOM')) {
        $('wodScoreType').value = 'REPS';
      } else if (rawType.includes('PESO') || rawType.includes('CARGA') || rawType.includes('1RM')) {
        $('wodScoreType').value = 'PESO / CARGA';
      }
    }
  };

  $('wodHasTimeCap')?.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    if ($('wodTimeCap')) {
      $('wodTimeCap').disabled = !isChecked;
      delete $('wodTimeCap').dataset.manualEdited;
      if (isChecked) {
        updateWodTimerUI();
        $('wodTimeCap').focus();
      } else {
        $('wodTimeCap').value = '';
      }
    }
    triggerAutoSave(true);
  });

  $('wodType')?.addEventListener('input', () => {
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
    updateScoreTypeSuggestion();
  });
  $('wodType')?.addEventListener('change', () => {
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
    updateScoreTypeSuggestion();
  });
  $('wodHasScore')?.addEventListener('change', () => {
    $('wodScoreConfigWrap')?.classList.toggle('hidden', !$('wodHasScore').checked);
    triggerAutoSave(true);
  });
  $('wodScoreType')?.addEventListener('change', () => {
    $('wodScoreType').dataset.manualEdited = 'true';
    triggerAutoSave(true);
  });
  $('wodTimeCap')?.addEventListener('input', () => {
    $('wodTimeCap').dataset.manualEdited = 'true';
  });

  // Tabata coach steppers
  $('btnCoachDecWork')?.addEventListener('click', () => {
    const cur = Number($('wodTabataWork')?.value) || 20;
    if ($('wodTabataWork')) $('wodTabataWork').value = Math.max(5, cur - 5);
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });
  $('btnCoachIncWork')?.addEventListener('click', () => {
    const cur = Number($('wodTabataWork')?.value) || 20;
    if ($('wodTabataWork')) $('wodTabataWork').value = cur + 5;
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });
  $('btnCoachDecRest')?.addEventListener('click', () => {
    const cur = $('wodTabataRest') && $('wodTabataRest').value !== '' ? Number($('wodTabataRest').value) : 10;
    if ($('wodTabataRest')) $('wodTabataRest').value = Math.max(0, cur - 5);
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });
  $('btnCoachIncRest')?.addEventListener('click', () => {
    const cur = $('wodTabataRest') && $('wodTabataRest').value !== '' ? Number($('wodTabataRest').value) : 10;
    if ($('wodTabataRest')) $('wodTabataRest').value = cur + 5;
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });
  $('btnCoachDecRounds')?.addEventListener('click', () => {
    const cur = Number($('wodTabataRounds')?.value) || 8;
    if ($('wodTabataRounds')) $('wodTabataRounds').value = Math.max(1, cur - 1);
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });
  $('btnCoachIncRounds')?.addEventListener('click', () => {
    const cur = Number($('wodTabataRounds')?.value) || 8;
    if ($('wodTabataRounds')) $('wodTabataRounds').value = Math.min(50, cur + 1);
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });



  // WOD EMOM steppers and presets
  $('btnCoachDecEmomInt')?.addEventListener('click', () => {
    const cur = Number($('wodEmomInterval')?.value) || 60;
    if ($('wodEmomInterval')) $('wodEmomInterval').value = Math.max(10, cur - 15);
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });
  $('btnCoachIncEmomInt')?.addEventListener('click', () => {
    const cur = Number($('wodEmomInterval')?.value) || 60;
    if ($('wodEmomInterval')) $('wodEmomInterval').value = Math.min(600, cur + 15);
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });
  $('btnCoachDecEmomRounds')?.addEventListener('click', () => {
    const cur = Number($('wodEmomRounds')?.value) || 10;
    if ($('wodEmomRounds')) $('wodEmomRounds').value = Math.max(1, cur - 1);
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });
  $('btnCoachIncEmomRounds')?.addEventListener('click', () => {
    const cur = Number($('wodEmomRounds')?.value) || 10;
    if ($('wodEmomRounds')) $('wodEmomRounds').value = Math.min(60, cur + 1);
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });


  // WOD Mins steppers
  $('btnCoachDecWodMins')?.addEventListener('click', () => {
    const cur = Number($('wodMinutes')?.value) || 12;
    if ($('wodMinutes')) $('wodMinutes').value = Math.max(1, cur - 1);
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });
  $('btnCoachIncWodMins')?.addEventListener('click', () => {
    const cur = Number($('wodMinutes')?.value) || 12;
    if ($('wodMinutes')) $('wodMinutes').value = Math.min(90, cur + 1);
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });

  // Direct inputs
  ['wodTabataWork', 'wodTabataRest', 'wodTabataRounds', 'wodEmomInterval', 'wodEmomRounds', 'wodMinutes'].forEach((id) => {
    $(id)?.addEventListener('input', () => {
      delete $('wodTimeCap').dataset.manualEdited;
      updateWodTimerUI();
    });
    $(id)?.addEventListener('change', () => {
      delete $('wodTimeCap').dataset.manualEdited;
      updateWodTimerUI();
    });
  });



  $('btnLaunchWodCronoPro')?.addEventListener('click', () => {
    const rawType = ($('wodType')?.value || '').toUpperCase();
    if (rawType.includes('SIN CRONO') || rawType === 'SIN') {
      return showToast('Elige un formato de crono para el WOD');
    }
    const mode = rawType.includes('TABATA') ? 'TABATA' : (rawType.includes('EMOM') ? 'EMOM' : (rawType.includes('TIME') ? 'FOR TIME' : 'AMRAP'));
    const spec = {
      mode,
      minutes: Number($('wodMinutes')?.value) || 12,
      workSec: Number($('wodTabataWork')?.value) || 20,
      restSec: Number($('wodTabataRest')?.value) || 10,
      tabataRounds: Number($('wodTabataRounds')?.value) || 8,
      intervalSec: Number($('wodEmomInterval')?.value) || 60,
    };
    openCoachCronoProModal(spec);
  });
}
initCoachWodTimerControls();

function loadCustomWodGoals() {
  try {
    const saved = JSON.parse(localStorage.getItem('hecthor_custom_wod_goals') || '[]');
    const sel = $('genGoal');
    if (!sel) return;
    const existing = new Set(Array.from(sel.options).map((o) => o.value));
    saved.forEach((g) => {
      if (!existing.has(g)) {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        const newMarker = sel.querySelector('option[value="__new__"]');
        if (newMarker) sel.insertBefore(opt, newMarker);
        else sel.appendChild(opt);
      }
    });
  } catch (_) {}
}

$('genGoal')?.addEventListener('change', (e) => {
  if (e.target.value === '__new__') {
    $('newGenGoalBox')?.classList.remove('hidden');
    $('newGenGoalInput')?.focus();
  } else {
    $('newGenGoalBox')?.classList.add('hidden');
  }
});
$('btnNewGenGoal')?.addEventListener('click', () => {
  $('newGenGoalBox')?.classList.toggle('hidden');
  if (!$('newGenGoalBox')?.classList.contains('hidden')) {
    $('newGenGoalInput')?.focus();
  }
});
function addCustomGenGoal() {
  const val = ($('newGenGoalInput')?.value || '').trim();
  if (!val) return;
  const sel = $('genGoal');
  if (sel) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    const newMarker = sel.querySelector('option[value="__new__"]');
    if (newMarker) sel.insertBefore(opt, newMarker);
    else sel.appendChild(opt);
    sel.value = val;
  }
  if ($('newGenGoalInput')) $('newGenGoalInput').value = '';
  $('newGenGoalBox')?.classList.add('hidden');
  try {
    const saved = JSON.parse(localStorage.getItem('hecthor_custom_wod_goals') || '[]');
    if (!saved.includes(val)) {
      saved.push(val);
      localStorage.setItem('hecthor_custom_wod_goals', JSON.stringify(saved));
    }
  } catch (_) {}
}
$('btnSaveGenGoal')?.addEventListener('click', addCustomGenGoal);
$('newGenGoalInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addCustomGenGoal();
  }
});

$('btnToggleNewSkill')?.addEventListener('click', () => {
  $('newSkillInputBox')?.classList.toggle('hidden');
  if (!$('newSkillInputBox')?.classList.contains('hidden')) {
    $('newSkillInput')?.focus();
  }
});
$('btnSaveNewSkill')?.addEventListener('click', addCustomSkill);
$('newSkillInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addCustomSkill();
  }
});

$('btnToggleWodGen').addEventListener('click', () => {
  $('wodGeneratorBox').classList.toggle('hidden');
});

$('btnRunWodGen').addEventListener('click', async () => {
  try {
    let wodType = $('genWodType').value;
    if (wodType === '__new__') {
      wodType = $('newWodTypeInput')?.value.trim() || 'AMRAP';
    }
    let goal = $('genGoal').value;
    if (goal === '__new__') {
      goal = $('newGenGoalInput')?.value.trim() || 'Híbrido';
    }
    const wod = await api('/api/generate-wod', {
      method: 'POST',
      body: JSON.stringify({
        equipment: Array.from(state.selectedEquipment),
        skills: Array.from(state.selectedSkills || []),
        time_minutes: Number($('genTime').value) || 15,
        wod_type: wodType,
        goal: goal,
      }),
    });

    // Guardar la recomendación generada en memoria (SOLO para consulta del coach)
    state.lastGeneratedWodRecommendation = wod;

    // Renderizar propuesta en el área de recomendación (NO toca la sesión actual ni el perfil del alumno)
    const recBox = $('wodGenRecommendationBox');
    const recContent = $('wodGenRecommendationContent');
    if (recBox && recContent) {
      recBox.classList.remove('hidden');
      const exRows = (wod.exercises || []).map((e, idx) => `
        <div style="padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
          <div>
            <strong style="color:#ffffff;">${idx + 1}.- ${esc(e.name || 'Ejercicio')}</strong>
            ${e.reps ? `<span style="color:#38bdf8; font-weight:700; margin-left:8px;">(${esc(e.reps)} reps)</span>` : ''}
            ${e.notes ? `<div class="muted" style="font-size:0.8rem; margin-top:2px;">${esc(e.notes)}</div>` : ''}
          </div>
          ${e.video_url ? `<a href="${esc(e.video_url)}" target="_blank" rel="noopener" style="font-size:0.75rem; color:#f97316; font-weight:700;">▶ Vídeo</a>` : ''}
        </div>
      `).join('');

      recContent.innerHTML = `
        <div style="margin-bottom:8px;">
          <div style="font-size:1.05rem; font-weight:900; color:#ffffff;">
            🎯 ${esc(wod.title || 'Propuesta de WOD')} <span style="font-size:0.85rem; color:#f97316; font-weight:700;">· ${esc(wod.type || wodType)}${wod.time_cap ? ` (CAP: ${esc(wod.time_cap)})` : ''}</span>
          </div>
        </div>
        ${exRows ? `<div style="margin:8px 0; background:rgba(0,0,0,0.35); border-radius:6px; padding:6px 12px;">${exRows}</div>` : ''}
        ${wod.rx_weights ? `<div style="font-size:0.83rem; color:#cbd5e1; margin-top:4px;"><strong>Rx sugerido:</strong> ${esc(wod.rx_weights)}</div>` : ''}
        ${wod.scaled_weights ? `<div style="font-size:0.83rem; color:#cbd5e1; margin-top:2px;"><strong>Escalado sugerido:</strong> ${esc(wod.scaled_weights)}</div>` : ''}
        ${wod.strategy ? `<div style="font-size:0.83rem; color:#cbd5e1; margin-top:4px;"><strong>Estrategia sugerida:</strong> ${esc(wod.strategy)}</div>` : ''}
        <div class="muted" style="font-size:0.78rem; margin-top:8px; font-style:italic;">
          ℹ️ Esta propuesta es SOLO una recomendación para el coach. NO modifica tu sesión ni se muestra en el perfil del alumno. Tu WOD se introduce siempre de forma manual.
        </div>
      `;
    }
    showToast('💡 Recomendación generada para tu consulta (no se añade al alumno).');
  } catch (err) {
    showToast(err.message);
  }
});

// Botón explícito para que el coach elija copiar la propuesta a su WOD manual si le convence
$('btnApplyWodGenToManual')?.addEventListener('click', () => {
  const wod = state.lastGeneratedWodRecommendation;
  if (!wod) {
    showToast('Genera primero una recomendación para poder usarla.');
    return;
  }
  if (!confirm('¿Copiar esta propuesta a tu WOD manual? Podrás editar o eliminar cualquier ejercicio con total libertad.')) return;

  $('wodTitle').value = wod.title || '';
  $('wodType').value = wod.type || 'AMRAP';
  const hasGenCap = Boolean(wod.time_cap && wod.time_cap.trim() !== '');
  if ($('wodHasTimeCap')) $('wodHasTimeCap').checked = hasGenCap;
  if ($('wodTimeCap')) {
    $('wodTimeCap').value = hasGenCap ? wod.time_cap : '';
    $('wodTimeCap').disabled = !hasGenCap;
  }
  $('wodTarget').value = wod.target_score || '';
  $('wodRx').value = wod.rx_weights || '';
  $('wodScaled').value = wod.scaled_weights || '';
  $('wodStrategy').value = wod.strategy || '';

  if (!state.currentDay.wod) state.currentDay.wod = {};
  state.currentDay.wod.exercises = Array.isArray(wod.exercises) ? JSON.parse(JSON.stringify(wod.exercises)) : [];
  state.currentDay.wod.is_manual = true;
  renderWodExercisesList();
  triggerAutoSave(true);
  showToast('✓ Propuesta copiada a tu WOD manual. Puedes modificarla como desees.');
});

// ================= AUTOGUARDADO AUTOMÁTICO =================
function buildCurrentDayPayload() {
  if (!state.currentDay) return null;

  // Asegurar que cualquier ejercicio con nombre enlace automáticamente su vídeo de biblioteca si está vacío,
  // y auto-sincronizar en la biblioteca cualquier ejercicio que tenga nombre y vídeo introducido
  const ensureExerciseVideo = (item, defaultCat = 'Fuerza') => {
    if (!item || !item.name) return;
    if (!item.video_url || item.video_url.trim() === '') {
      const match = findLibraryExercise(item.name);
      if (match && match.video_url) {
        item.video_url = match.video_url;
        if (!item.notes && (match.coaching_cues || match.description)) {
          item.notes = match.coaching_cues || match.description;
        }
      }
    } else {
      autoSyncExerciseToLibrary(item.name, item.video_url, item.notes, defaultCat);
    }
    (item.sub_exercises || []).forEach((sub) => ensureExerciseVideo(sub, defaultCat));
  };

  (state.currentDay.warmup_exercises || []).forEach((ex) => ensureExerciseVideo(ex, 'Calentamiento'));
  (state.currentDay.parts || []).forEach((p) => {
    (p.exercises || []).forEach((ex) => ensureExerciseVideo(ex, p.type || 'Fuerza'));
  });
  if (state.currentDay.wod && Array.isArray(state.currentDay.wod.exercises)) {
    state.currentDay.wod.exercises.forEach((ex) => ensureExerciseVideo(ex, 'WOD'));
  }

  return {
    title: $('dayTitle')?.value.trim() || `Día ${state.currentDay.day_number}`,
    warmup_type: $('warmupTypeSelect')?.value || 'Movilidad GROUND',
    warmup_notes: $('warmupNotes')?.value.trim() || '',
    warmup_timer: {
      type: 'SIN CRONO',
      minutes: Number($('warmupTimerMinutes')?.value) || 8,
      tabata_work: Number($('warmupTabataWork')?.value) || 20,
      tabata_rest: $('warmupTabataRest') && $('warmupTabataRest').value !== '' ? Number($('warmupTabataRest').value) : 10,
      tabata_rounds: Number($('warmupTabataRounds')?.value) || 8,
      emom_interval: Number($('warmupEmomInterval')?.value) || 60,
      emom_rounds: Number($('warmupEmomRounds')?.value) || 8,
    },
    warmup_exercises: state.currentDay.warmup_exercises || [],
    parts: state.currentDay.parts || [],
    wod: {
      title: $('wodTitle')?.value.trim() || '',
      type: $('wodType')?.value.trim() || '',
      has_time_cap: $('wodHasTimeCap') ? $('wodHasTimeCap').checked : Boolean($('wodTimeCap')?.value.trim()),
      time_cap: $('wodHasTimeCap')?.checked ? $('wodTimeCap')?.value.trim() || '' : '',
      target_score: $('wodTarget')?.value.trim() || '',
      description: '',
      rx_weights: $('wodRx')?.value.trim() || '',
      scaled_weights: $('wodScaled')?.value.trim() || '',
      strategy: $('wodStrategy')?.value.trim() || '',
      has_score: $('wodHasScore')?.checked !== undefined ? $('wodHasScore').checked : true,
      score_type: $('wodScoreType')?.value || 'LIBRE',
      equipment: Array.from(state.selectedEquipment || []),
      exercises: state.currentDay.wod?.exercises || [],
      movements: state.currentDay.wod?.exercises || [],
      tabata_work: Number($('wodTabataWork')?.value) || 20,
      tabata_rest: $('wodTabataRest') && $('wodTabataRest').value !== '' ? Number($('wodTabataRest').value) : 10,
      tabata_rounds: Number($('wodTabataRounds')?.value) || 8,
      emom_interval: Number($('wodEmomInterval')?.value) || 60,
      emom_rounds: Number($('wodEmomRounds')?.value) || 10,
      minutes: Number($('wodMinutes')?.value) || 12,
    },
    coaching_tips: $('dayCoachingTips')?.value.trim() || '',
  };
}

function setAutoSaveStatus(status) {
  const badge = $('autoSaveBadge');
  if (!badge) return;
  if (status === 'saving') {
    badge.className = 'badge';
    badge.style.marginLeft = '6px';
    badge.style.fontSize = '0.78rem';
    badge.style.background = 'rgba(250, 204, 21, 0.15)';
    badge.style.color = '#facc15';
    badge.style.border = '1px solid rgba(250, 204, 21, 0.35)';
    badge.textContent = '⏳ Guardando...';
    badge.classList.remove('hidden');
  } else if (status === 'saved') {
    badge.className = 'badge badge-ground';
    badge.style.marginLeft = '6px';
    badge.style.fontSize = '0.78rem';
    badge.style.background = '';
    badge.style.color = '';
    badge.style.border = '';
    badge.textContent = '✓ Guardado automáticamente';
    badge.classList.remove('hidden');
    setTimeout(() => {
      if (badge && !isSaving && !pendingSave) {
        badge.classList.add('hidden');
      }
    }, 3500);
  } else if (status === 'error') {
    badge.className = 'badge badge-danger';
    badge.style.marginLeft = '6px';
    badge.style.fontSize = '0.78rem';
    badge.textContent = '⚠ Error al autoguardar';
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function triggerAutoSave(immediate = false) {
  if (!state.currentDay) return;
  pendingSave = true;

  // Persistencia local inmediata (indestructible ante recargas de página o cierres)
  try {
    const payload = buildCurrentDayPayload();
    if (payload) {
      localStorage.setItem(`hecthor_draft_day_${state.currentDay.id}`, JSON.stringify({
        timestamp: Date.now(),
        payload,
      }));
    }
  } catch (_) {}

  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  if (immediate) {
    doAutoSave();
  } else {
    autoSaveTimer = setTimeout(() => {
      doAutoSave();
    }, 300);
  }
}

function saveLocalStateSnapshot() {
  try {
    if (!state.currentMicrocycle) return;
    const snap = {
      timestamp: Date.now(),
      microcycles: state.microcycles || [],
      currentMicrocycle: state.currentMicrocycle,
      exercises: state.exercises || [],
    };
    localStorage.setItem('hecthor_crossfit_coach_backup', JSON.stringify(snap));
  } catch (e) {
    console.warn('Could not save local snapshot', e);
  }
}

async function doAutoSave() {
  if (!state.currentDay || isSaving) return;
  const payload = buildCurrentDayPayload();
  if (!payload) return;
  isSaving = true;
  pendingSave = false;
  setAutoSaveStatus('saving');
  try {
    await api(`/api/days/${state.currentDay.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (state.currentMicrocycle && Array.isArray(state.currentMicrocycle.days)) {
      const idx = state.currentMicrocycle.days.findIndex((d) => d.id === state.currentDay.id);
      if (idx >= 0) {
        state.currentMicrocycle.days[idx] = { ...state.currentMicrocycle.days[idx], ...payload };
      }
    }
    setAutoSaveStatus('saved');
    saveLocalStateSnapshot();
  } catch (err) {
    console.error('AutoSave error:', err);
    setAutoSaveStatus('error');
  } finally {
    isSaving = false;
    if (pendingSave) {
      triggerAutoSave(false);
    }
  }
}

// Save day manual button
async function saveCurrentDay() {
  if (!state.currentDay) return;
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  const payload = buildCurrentDayPayload();
  if (!payload) return;
  try {
    await api(`/api/days/${state.currentDay.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    pendingSave = false;
    if (state.currentMicrocycle?.id) {
      const mc = await api(`/api/microcycles/${state.currentMicrocycle.id}`);
      state.currentMicrocycle = mc;
      renderDaysGrid();
    }
    setAutoSaveStatus('saved');
    saveLocalStateSnapshot();
    showToast('Sesión guardada correctamente');
  } catch (err) {
    showToast(err.message);
  }
}

$('btnSaveDay')?.addEventListener('click', saveCurrentDay);
$('btnSaveDayBottom')?.addEventListener('click', saveCurrentDay);

// Listen to all edits on dayEditorCard for continuous auto-save
$('dayEditorCard')?.addEventListener('input', (e) => {
  if (e.target.closest('.modal') || e.target.closest('.modal-backdrop')) return;
  triggerAutoSave(false);
});
$('dayEditorCard')?.addEventListener('change', (e) => {
  if (e.target.closest('.modal') || e.target.closest('.modal-backdrop')) return;
  triggerAutoSave(true);
});

// Intercept navigation to Alumnos view or external pages to guarantee changes are saved first
document.querySelectorAll('a[href*="/alumnos"]').forEach((a) => {
  a.addEventListener('click', async (e) => {
    e.preventDefault();
    const href = a.getAttribute('href');
    if (state.currentDay) {
      await saveCurrentDay();
    }
    window.location.href = href;
  });
});

// Guard changes on tab close or navigation
window.addEventListener('beforeunload', () => {
  saveLocalStateSnapshot();
  if (state.currentDay && pendingSave) {
    const payload = buildCurrentDayPayload();
    if (payload) {
      try {
        const token = getAuthToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        fetch(`/api/days/${state.currentDay.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(payload),
          keepalive: true,
        });
      } catch (_) {}
    }
  }
});

// ================= BACKUP & RESTORE MODAL =================
function updateLocalBackupStatusText() {
  const statusEl = $('localBackupStatusText');
  if (!statusEl) return;
  try {
    const raw = localStorage.getItem('hecthor_crossfit_coach_backup');
    if (!raw) {
      statusEl.textContent = 'Aún no hay copias automáticas guardadas en este navegador.';
      return;
    }
    const snap = JSON.parse(raw);
    const dateStr = snap.timestamp ? new Date(snap.timestamp).toLocaleString('es-ES') : 'reciente';
    const mcCount = (snap.microcycles || []).length;
    statusEl.innerHTML = `Última copia local guardada: <strong>${dateStr}</strong> (${mcCount} mesociclos en memoria).`;
  } catch (_) {
    statusEl.textContent = 'Copia local presente.';
  }
}

$('btnOpenBackupModal')?.addEventListener('click', () => {
  updateLocalBackupStatusText();
  $('backupModal')?.classList.add('open');
});

$('btnDownloadBackup')?.addEventListener('click', async () => {
  try {
    const backupData = await api('/api/backup/export');
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `hecthor_wod_backup_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Copia de seguridad descargada correctamente');
  } catch (err) {
    showToast('Error al descargar copia: ' + err.message);
  }
});

$('btnTriggerRestoreFile')?.addEventListener('click', () => {
  $('backupFileInput')?.click();
});

$('backupFileInput')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const statusEl = $('backupFileStatus');
  if (statusEl) statusEl.textContent = `Leyendo archivo ${file.name}...`;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || (!data.microcycles && !data.days)) {
      throw new Error('El archivo no contiene una copia válida de hecTHOR WOD.');
    }
    if (statusEl) statusEl.textContent = 'Restaurando en la base de datos...';
    const res = await api('/api/backup/import', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (statusEl) statusEl.innerHTML = `✅ <strong style="color:#22c55e;">Restaurado con éxito</strong>: ${res.imported_microcycles} mesociclos, ${res.imported_days} días y ${res.imported_exercises} ejercicios.`;
    showToast('¡Copia de seguridad restaurada correctamente!');
    await loadMicrocycles();
    await loadLibrary();
    saveLocalStateSnapshot();
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `❌ <strong style="color:#ef4444;">Error:</strong> ${err.message}`;
    showToast('Error al restaurar: ' + err.message);
  }
  e.target.value = '';
});

$('btnRestoreLocalBackup')?.addEventListener('click', async () => {
  try {
    const raw = localStorage.getItem('hecthor_crossfit_coach_backup');
    if (!raw) return showToast('No hay ninguna copia local guardada en este navegador.');
    const snap = JSON.parse(raw);
    const payload = {
      microcycles: snap.microcycles || [],
      days: (snap.currentMicrocycle?.days || []),
      exercises: state.exercises || [],
    };
    if (confirm('¿Restaurar la copia local guardada en este navegador en el servidor?')) {
      const res = await api('/api/backup/import', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      showToast(`¡Copia local restaurada! (${res.imported_microcycles} mesociclos, ${res.imported_days} días)`);
      await loadMicrocycles();
      $('backupModal')?.classList.remove('open');
    }
  } catch (err) {
    showToast('Error al restaurar copia local: ' + err.message);
  }
});

$('btnRestoreServerAutoBackup')?.addEventListener('click', async () => {
  try {
    if (!confirm('¿Restaurar la última copia automática generada en el servidor? Esto recuperará los mesociclos y días guardados.')) return;
    const statusEl = $('serverBackupStatus');
    if (statusEl) statusEl.textContent = 'Restaurando copia del servidor...';
    const res = await api('/api/backup/auto-restore', { method: 'POST' });
    showToast(`¡Copia del servidor restaurada con éxito! (${res.restored_microcycles} mesociclos, ${res.restored_days} días)`);
    if (statusEl) statusEl.textContent = `Restaurado: ${res.restored_microcycles} mesociclos, ${res.restored_days} días.`;
    await loadMicrocycles();
    $('backupModal')?.classList.remove('open');
  } catch (err) {
    showToast('Error al restaurar copia del servidor: ' + err.message);
    const statusEl = $('serverBackupStatus');
    if (statusEl) statusEl.textContent = 'Error: ' + err.message;
  }
});

$('btnCopyDay').addEventListener('click', async () => {
  const targetId = Number($('copyTargetDay').value);
  if (!targetId || !state.currentDay) return;
  try {
    await saveCurrentDay();
    await api(`/api/days/copy?source_day_id=${state.currentDay.id}&target_day_id=${targetId}`, {
      method: 'POST',
    });
    const mc = await api(`/api/microcycles/${state.currentMicrocycle.id}`);
    state.currentMicrocycle = mc;
    renderDaysGrid();
    showToast('Sesión copiada al día destino');
  } catch (err) {
    showToast(err.message);
  }
});

// Microcycle CRUD & Custom Goals
function loadCustomGoals() {
  try {
    const saved = JSON.parse(localStorage.getItem('hecthor_custom_mc_goals') || '[]');
    const sel = $('mcGoal');
    if (!sel) return;
    const existing = new Set(Array.from(sel.options).map((o) => o.value));
    saved.forEach((g) => {
      if (!existing.has(g)) {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        const newMarker = sel.querySelector('option[value="__new__"]');
        if (newMarker) sel.insertBefore(opt, newMarker);
        else sel.appendChild(opt);
      }
    });
  } catch (_) {}
}

$('mcGoal')?.addEventListener('change', (e) => {
  if (e.target.value === '__new__') {
    $('newMcGoalBox')?.classList.remove('hidden');
    $('newMcGoalInput')?.focus();
  } else {
    $('newMcGoalBox')?.classList.add('hidden');
  }
});
$('btnNewMcGoal')?.addEventListener('click', () => {
  $('newMcGoalBox')?.classList.toggle('hidden');
  if (!$('newMcGoalBox')?.classList.contains('hidden')) {
    $('newMcGoalInput')?.focus();
  }
});
function addCustomMcGoal() {
  const val = ($('newMcGoalInput')?.value || '').trim();
  if (!val) return;
  const sel = $('mcGoal');
  if (sel) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    const newMarker = sel.querySelector('option[value="__new__"]');
    if (newMarker) sel.insertBefore(opt, newMarker);
    else sel.appendChild(opt);
    sel.value = val;
  }
  if ($('newMcGoalInput')) $('newMcGoalInput').value = '';
  $('newMcGoalBox')?.classList.add('hidden');
  try {
    const saved = JSON.parse(localStorage.getItem('hecthor_custom_mc_goals') || '[]');
    if (!saved.includes(val)) {
      saved.push(val);
      localStorage.setItem('hecthor_custom_mc_goals', JSON.stringify(saved));
    }
  } catch (_) {}
}
$('btnSaveMcGoal')?.addEventListener('click', addCustomMcGoal);
$('newMcGoalInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addCustomMcGoal();
  }
});

let editingMicrocycleId = null;

$('btnEditMicrocycle')?.addEventListener('click', () => {
  if (!state.currentMicrocycle) {
    showToast('Selecciona primero un mesociclo para modificar');
    return;
  }
  editingMicrocycleId = state.currentMicrocycle.id;
  if ($('mcModalTitle')) $('mcModalTitle').textContent = 'Modificar Mesociclo';
  if ($('btnCreateMicrocycleSubmit')) $('btnCreateMicrocycleSubmit').textContent = 'Guardar Cambios';
  if ($('mcDurationFields')) $('mcDurationFields').style.display = 'none';

  $('mcName').value = state.currentMicrocycle.name || '';
  $('mcCode').value = state.currentMicrocycle.access_code || '';
  $('mcStartDate').value = state.currentMicrocycle.start_date || '';
  $('mcDesc').value = state.currentMicrocycle.description || '';
  
  const g = state.currentMicrocycle.primary_goal || 'Fuerza';
  const sel = $('mcGoal');
  if (sel) {
    if (!Array.from(sel.options).some((o) => o.value === g)) {
      const opt = document.createElement('option');
      opt.value = g;
      opt.textContent = g;
      sel.appendChild(opt);
    }
    sel.value = g;
  }
  $('newMcGoalBox')?.classList.add('hidden');
  openModal('microcycleModal');
});

$('btnNewMicrocycle').addEventListener('click', () => {
  editingMicrocycleId = null;
  if ($('mcModalTitle')) $('mcModalTitle').textContent = 'Crear Nuevo Mesociclo';
  if ($('btnCreateMicrocycleSubmit')) $('btnCreateMicrocycleSubmit').textContent = 'Crear Mesociclo';
  if ($('mcDurationFields')) $('mcDurationFields').style.display = 'grid';

  $('mcName').value = '';
  $('mcDesc').value = '';
  $('mcCode').value = 'CF' + Math.floor(1000 + Math.random() * 9000);
  $('mcStartDate').value = getDefaultMondayIso();
  $('newMcGoalBox')?.classList.add('hidden');
  openModal('microcycleModal');
});

$('btnCreateMicrocycleSubmit').addEventListener('click', async () => {
  const name = $('mcName').value.trim();
  const code = $('mcCode').value.trim().toUpperCase();
  if (!name) {
    showToast('Introduce el nombre del mesociclo');
    return;
  }
  let primaryGoal = $('mcGoal').value;
  if (primaryGoal === '__new__') {
    primaryGoal = ($('newMcGoalInput')?.value || '').trim() || 'Fuerza';
  }
  try {
    if (editingMicrocycleId) {
      await api(`/api/microcycles/${editingMicrocycleId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name,
          primary_goal: primaryGoal,
          description: $('mcDesc').value.trim(),
          access_code: code || state.currentMicrocycle?.access_code || 'CF2026',
          start_date: $('mcStartDate').value || getDefaultMondayIso(),
        }),
      });
      closeModal('microcycleModal');
      await loadMicrocycles(editingMicrocycleId);
      showToast('Mesociclo actualizado correctamente');
    } else {
      if (!code) {
        showToast('Introduce el código de acceso');
        return;
      }
      const res = await api('/api/microcycles', {
        method: 'POST',
        body: JSON.stringify({
          name,
          weeks_count: Number($('mcWeeks').value) || 4,
          days_per_week: Number($('mcDays').value) || 5,
          primary_goal: primaryGoal,
          description: $('mcDesc').value.trim(),
          access_code: code,
          start_date: $('mcStartDate').value || getDefaultMondayIso(),
        }),
      });
      closeModal('microcycleModal');
      $('mcName').value = '';
      $('mcDesc').value = '';
      await loadMicrocycles(res.id);
      showToast('Mesociclo creado');
    }
  } catch (err) {
    showToast(err.message);
  }
});

$('btnDeleteMicrocycle').addEventListener('click', async () => {
  if (!state.currentMicrocycle) return;
  if (!confirm(`¿Eliminar el mesociclo "${state.currentMicrocycle.name}" y todas sus semanas y sesiones?`)) return;
  await api(`/api/microcycles/${state.currentMicrocycle.id}`, { method: 'DELETE' });
  await loadMicrocycles();
  showToast('Mesociclo eliminado');
});

// Library
const DEFAULT_CATEGORIES = [
  { key: 'ground', label: 'GROUND' },
  { key: 'halterofilia', label: 'Halterofilia' },
  { key: 'fuerza', label: 'Fuerza' },
  { key: 'gimnasticos', label: 'Gimnásticos' },
  { key: 'metcon', label: 'Metcon / Cardio' },
];

let libraryCat = '';
let editingExerciseId = null;

function getAllCategories() {
  const map = new Map(DEFAULT_CATEGORIES.map((c) => [c.key.toLowerCase(), c.label]));
  state.exercises.forEach((ex) => {
    const raw = (ex.category || '').trim();
    if (raw && !map.has(raw.toLowerCase())) {
      map.set(raw.toLowerCase(), raw);
    }
  });
  return Array.from(map.entries()).map(([key, label]) => ({ key, label }));
}

function renderLibraryFilters() {
  const wrap = $('libraryFilters');
  const cats = getAllCategories();
  wrap.innerHTML = '';

  const chips = [{ key: '', label: 'Todos' }, ...cats];
  chips.forEach((c) => {
    const span = document.createElement('span');
    span.className = `chip ${libraryCat === c.key ? 'selected' : ''}`;
    span.textContent = c.label;
    span.addEventListener('click', () => {
      libraryCat = c.key;
      renderLibraryFilters();
      renderLibrary();
    });
    wrap.appendChild(span);
  });
}

function renderLibrary() {
  renderLibraryFilters();
  const grid = $('libraryGrid');
  const items = state.exercises.filter((ex) => {
    if (!libraryCat) return true;
    if (libraryCat === 'ground') return ex.is_ground === 1 || (ex.category || '').toLowerCase() === 'ground';
    return (ex.category || '').toLowerCase() === libraryCat.toLowerCase();
  });
  grid.innerHTML = '';
  if (items.length === 0) {
    grid.innerHTML = '<p class="muted">No hay ejercicios en esta categoría. Pulsa "+ Añadir Ejercicio" para crear uno.</p>';
    return;
  }
  items.forEach((ex) => {
    const card = document.createElement('div');
    card.className = 'item-box';
    card.innerHTML = `
      <div class="row-between">
        <strong>${esc(ex.name)}</strong>
        <div class="row-wrap">
          <span class="badge">${esc(ex.category)}</span>
          ${ex.is_ground ? `<span class="badge badge-ground">GROUND · ${esc(ex.ground_flow_level || 'Todos')}</span>` : ''}
        </div>
      </div>
      <p class="muted" style="margin:6px 0;">${esc(ex.description)}</p>
      ${ex.coaching_cues ? `<p style="font-size:0.84rem; margin:0 0 8px;"><strong>Claves:</strong> ${esc(ex.coaching_cues)}</p>` : ''}
      <div class="row-between">
        <div class="row-wrap">
          <button class="btn btn-sm" data-play>▶ Ver vídeo</button>
          <button class="btn btn-sm" data-edit>✏️ Editar / Vídeo</button>
        </div>
        <button class="btn btn-danger btn-sm" data-del>Eliminar</button>
      </div>
    `;
    card.querySelector('[data-play]').addEventListener('click', () => openVideoModal(ex.name, ex.video_url));
    card.querySelector('[data-edit]').addEventListener('click', () => openExerciseModal(ex));
    card.querySelector('[data-del]').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar "${ex.name}" de la biblioteca?`)) return;
      await api(`/api/exercises/${ex.id}`, { method: 'DELETE' });
      await loadExercises();
      renderLibrary();
      showToast('Ejercicio eliminado');
    });
    grid.appendChild(card);
  });
}

function populateCategorySelect(selectedCat = 'fuerza') {
  const sel = $('exCategory');
  const cats = getAllCategories();
  sel.innerHTML = '';
  cats.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.key;
    opt.textContent = c.label;
    sel.appendChild(opt);
  });
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ Crear nueva categoría...';
  sel.appendChild(newOpt);

  const match = cats.find((c) => c.key === (selectedCat || '').toLowerCase());
  if (match) {
    sel.value = match.key;
    $('exCategoryCustom').classList.add('hidden');
    $('exCategoryCustom').value = '';
  } else if (selectedCat) {
    sel.value = '__new__';
    $('exCategoryCustom').classList.remove('hidden');
    $('exCategoryCustom').value = selectedCat;
  }
}

function updateYtSearchHref() {
  const name = $('exName').value.trim().replace(/\(GROUND\)/gi, '').trim() || 'crossfit exercise';
  $('exSearchYt').href = `https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' crossfit tutorial')}`;
}

function openExerciseModal(ex = null) {
  editingExerciseId = ex ? ex.id : null;
  $('exerciseModalTitle').textContent = ex ? 'Editar Ejercicio / Vídeo / GROUND' : 'Añadir Ejercicio a la Biblioteca';
  $('exName').value = ex ? ex.name || '' : '';
  const defaultCat = ex ? ex.category : (libraryCat || 'fuerza');
  populateCategorySelect(defaultCat);
  $('exIsGround').checked = ex ? Boolean(ex.is_ground) : defaultCat === 'ground';
  $('exLevel').value = ex && ex.ground_flow_level && ex.ground_flow_level !== 'N/A' ? ex.ground_flow_level : 'Todos';
  $('exLevel').disabled = !$('exIsGround').checked;
  $('exVideo').value = ex ? ex.video_url || '' : '';
  $('exDesc').value = ex ? ex.description || '' : '';
  $('exCues').value = ex ? ex.coaching_cues || '' : '';
  updateYtSearchHref();
  openModal('exerciseModal');
}

$('exName').addEventListener('input', updateYtSearchHref);
$('exCategory').addEventListener('change', (e) => {
  const isNew = e.target.value === '__new__';
  $('exCategoryCustom').classList.toggle('hidden', !isNew);
  if (!editingExerciseId && e.target.value === 'ground') {
    $('exIsGround').checked = true;
    $('exLevel').disabled = false;
  }
});
$('exIsGround').addEventListener('change', (e) => {
  $('exLevel').disabled = !e.target.checked;
});

$('btnNewExercise').addEventListener('click', () => openExerciseModal(null));
$('btnSaveExerciseSubmit').addEventListener('click', async () => {
  const name = $('exName').value.trim();
  if (!name) return showToast('Introduce el nombre del ejercicio');

  let cat = $('exCategory').value;
  if (cat === '__new__') {
    cat = $('exCategoryCustom').value.trim().toLowerCase();
    if (!cat) return showToast('Escribe el nombre de la nueva categoría');
  }

  const isGround = $('exIsGround').checked ? 1 : 0;
  const payload = {
    name,
    category: cat,
    equipment: [],
    description: $('exDesc').value.trim(),
    coaching_cues: $('exCues').value.trim(),
    video_url: $('exVideo').value.trim(),
    is_ground: isGround,
    ground_flow_level: isGround ? $('exLevel').value : 'N/A',
  };

  try {
    if (editingExerciseId) {
      await api(`/api/exercises/${editingExerciseId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      showToast('Ejercicio actualizado');
    } else {
      const created = await api('/api/exercises', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      showToast('Ejercicio añadido');
      if (state.pickerTarget) {
        pickExerciseIntoTarget(created || { ...payload, id: Date.now() });
        closeModal('pickerModal');
      }
    }
    closeModal('exerciseModal');
    await loadExercises();
    renderLibrary();
  } catch (err) {
    showToast(err.message);
  }
});

// Logs
async function loadLogs() {
  if (!state.currentMicrocycle) return;
  const logs = await api(`/api/student/logs/${state.currentMicrocycle.id}`);
  const wrap = $('logsContainer');
  if (logs.length === 0) {
    wrap.innerHTML = '<p class="muted">Todavía no hay resultados registrados en este microciclo.</p>';
    return;
  }
  wrap.innerHTML = '';
  logs.forEach((l) => {
    const box = document.createElement('div');
    box.className = 'item-box';
    box.innerHTML = `
      <div class="row-between">
        <strong>${esc(l.student_name)}</strong>
        <span class="badge badge-accent">${esc(l.score)} (${esc(l.rx_status)})</span>
      </div>
      <div class="muted">Semana ${l.week_number} · Día ${l.day_number}: ${esc(l.day_title)}</div>
      ${l.weights_used ? `<div style="font-size:0.86rem; margin-top:4px;">Pesos: ${esc(l.weights_used)}</div>` : ''}
      ${l.notes ? `<div class="muted" style="margin-top:2px;">${esc(l.notes)}</div>` : ''}
    `;
    wrap.appendChild(box);
  });
}
$('btnRefreshLogs').addEventListener('click', loadLogs);

// Share & QR Modal
async function updateShareQr() {
  await loadServerInfo();
  const info = state.serverInfo;
  const code = state.currentMicrocycle?.access_code || '';
  const url = state.qrMode === 'student'
    ? `${info.student_url}${code ? `?code=${encodeURIComponent(code)}` : ''}`
    : info.coach_url;

  $('shareUrlText').textContent = url;
  $('qrContainer').innerHTML = 'Generando QR...';
  const res = await fetch(`/api/qr?text=${encodeURIComponent(url)}`, {
    headers: { Authorization: `Bearer ${getAuthToken('coach')}` },
  });
  $('qrContainer').innerHTML = await res.text();
}

$('btnShareMobile').addEventListener('click', () => {
  openModal('shareModal');
  updateShareQr();
});

$('qrModeStudent').addEventListener('click', () => {
  state.qrMode = 'student';
  $('qrModeStudent').classList.add('selected');
  $('qrModeCoach').classList.remove('selected');
  updateShareQr();
});
$('qrModeCoach').addEventListener('click', () => {
  state.qrMode = 'coach';
  $('qrModeCoach').classList.add('selected');
  $('qrModeStudent').classList.remove('selected');
  updateShareQr();
});
$('btnCopyShareUrl').addEventListener('click', async () => {
  const txt = $('shareUrlText').textContent;
  await navigator.clipboard.writeText(txt).catch(() => {});
  showToast('Enlace copiado');
});

// ================= STUDENTS APPROVAL & MANAGEMENT =================
async function loadStudents() {
  try {
    state.students = await api('/api/coach/students');
    renderStudentsTab();
  } catch (err) {
    if (err.status === 401) clearAuthToken('coach');
  }
}

function buildMicrocycleOptionsHtml(selectedId) {
  const opts = [`<option value="">Todos los microciclos activos</option>`];
  (state.microcycles || []).forEach((mc) => {
    const sel = Number(selectedId) === Number(mc.id) ? 'selected' : '';
    opts.push(`<option value="${mc.id}" ${sel}>${esc(mc.name)} (${esc(mc.access_code)})</option>`);
  });
  return opts.join('');
}

function renderStudentsTab() {
  const students = state.students || [];
  const pending = students.filter((s) => s.status === 'pending');
  const others = students.filter((s) => s.status !== 'pending');

  const badge = $('pendingStudentsBadge');
  if (badge) {
    badge.textContent = String(pending.length);
    badge.classList.toggle('hidden', pending.length === 0);
  }

  const pWrap = $('pendingStudentsList');
  if (pWrap) {
    if (pending.length === 0) {
      pWrap.innerHTML = '<p class="muted">No hay solicitudes pendientes en este momento.</p>';
    } else {
      pWrap.innerHTML = '';
      pending.forEach((s) => {
        const box = document.createElement('div');
        box.className = 'item-box';
        box.style.borderColor = 'rgba(255, 107, 53, 0.45)';
        box.innerHTML = `
          <div class="row-between">
            <div>
              <strong>${esc(s.full_name)}</strong>
              <span class="badge badge-orange" style="margin-left:6px;">Pendiente</span>
              <div class="muted" style="margin-top:4px;">📧 ${esc(s.email)}${s.phone ? ` · 📱 ${esc(s.phone)}` : ''}</div>
            </div>
            <div class="row-wrap">
              <select class="input" data-stu-mc style="width:auto; min-width:190px; padding:6px 10px; font-size:0.84rem;">
                ${buildMicrocycleOptionsHtml(s.assigned_microcycle_id)}
              </select>
              <button class="btn btn-primary btn-sm" data-approve>✓ Aprobar</button>
              <button class="btn btn-danger btn-sm" data-reject>✕ Rechazar</button>
            </div>
          </div>
        `;
        box.querySelector('[data-approve]').addEventListener('click', async () => {
          const mcVal = box.querySelector('[data-stu-mc]').value;
          await api(`/api/coach/students/${s.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              status: 'approved',
              assigned_microcycle_id: mcVal ? Number(mcVal) : null,
              clear_microcycle_assignment: !mcVal,
            }),
          });
          showToast(`Alumno ${s.full_name} aprobado`);
          loadStudents();
        });
        box.querySelector('[data-reject]').addEventListener('click', async () => {
          await api(`/api/coach/students/${s.id}`, {
            method: 'PUT',
            body: JSON.stringify({ status: 'rejected' }),
          });
          showToast(`Solicitud rechazada`);
          loadStudents();
        });
        pWrap.appendChild(box);
      });
    }
  }

  const aWrap = $('approvedStudentsList');
  if (aWrap) {
    if (others.length === 0) {
      aWrap.innerHTML = '<p class="muted">Todavía no hay alumnos aprobados.</p>';
    } else {
      aWrap.innerHTML = '';
      others.forEach((s) => {
        const isApproved = s.status === 'approved';
        const box = document.createElement('div');
        box.className = 'item-box';
        box.innerHTML = `
          <div class="row-between">
            <div>
              <strong>${esc(s.full_name)}</strong>
              <span class="badge ${isApproved ? 'badge-ground' : 'badge-danger'}" style="margin-left:6px;">
                ${isApproved ? 'Aprobado' : 'Bloqueado / Rechazado'}
              </span>
              <div class="muted" style="margin-top:4px;">📧 ${esc(s.email)}${s.phone ? ` · 📱 ${esc(s.phone)}` : ''}</div>
            </div>
            <div class="row-wrap">
              <select class="input" data-stu-mc style="width:auto; min-width:190px; padding:6px 10px; font-size:0.84rem;">
                ${buildMicrocycleOptionsHtml(s.assigned_microcycle_id)}
              </select>
              ${isApproved
                ? `<button class="btn btn-sm" data-block>Bloquear</button>`
                : `<button class="btn btn-primary btn-sm" data-reactivate>Reaprobar</button>`}
              <button class="btn btn-danger btn-sm" data-del>Eliminar</button>
            </div>
          </div>
        `;
        box.querySelector('[data-stu-mc]').addEventListener('change', async (e) => {
          const val = e.target.value;
          await api(`/api/coach/students/${s.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              assigned_microcycle_id: val ? Number(val) : null,
              clear_microcycle_assignment: !val,
            }),
          });
          showToast('Programa actualizado para el alumno');
          loadStudents();
        });
        box.querySelector('[data-block]')?.addEventListener('click', async () => {
          await api(`/api/coach/students/${s.id}`, {
            method: 'PUT',
            body: JSON.stringify({ status: 'rejected' }),
          });
          showToast('Acceso bloqueado');
          loadStudents();
        });
        box.querySelector('[data-reactivate]')?.addEventListener('click', async () => {
          await api(`/api/coach/students/${s.id}`, {
            method: 'PUT',
            body: JSON.stringify({ status: 'approved' }),
          });
          showToast('Alumno reactivado');
          loadStudents();
        });
        box.querySelector('[data-del]').addEventListener('click', async () => {
          if (!confirm(`¿Eliminar permanentemente a ${s.full_name}?`)) return;
          await api(`/api/coach/students/${s.id}`, { method: 'DELETE' });
          showToast('Alumno eliminado');
          loadStudents();
        });
        aWrap.appendChild(box);
      });
    }
  }
}

$('btnRefreshStudents')?.addEventListener('click', loadStudents);
$('btnToggleAddStudent')?.addEventListener('click', () => {
  $('manualStudentForm').classList.toggle('hidden');
});
$('btnCancelManualStudent')?.addEventListener('click', () => {
  $('manualStudentForm').classList.add('hidden');
});
$('btnCreateStudentSubmit')?.addEventListener('click', async () => {
  const full_name = $('newStuName').value.trim();
  const email = $('newStuEmail').value.trim();
  const phone = $('newStuPhone').value.trim();
  const password = $('newStuPass').value;
  if (!full_name || !email || password.length < 4) {
    return showToast('Nombre, email y contraseña (mín. 4) son obligatorios');
  }
  try {
    await api('/api/coach/students', {
      method: 'POST',
      body: JSON.stringify({ full_name, email, phone, password }),
    });
    $('newStuName').value = '';
    $('newStuEmail').value = '';
    $('newStuPhone').value = '';
    $('newStuPass').value = '';
    $('manualStudentForm').classList.add('hidden');
    showToast('Alumno creado y aprobado');
    loadStudents();
  } catch (err) {
    showToast(err.message);
  }
});

checkAuthAndBoot();
