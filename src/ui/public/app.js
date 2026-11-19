'use strict';

let state = { shows: [], proposals: [] };
let showId = localStorage.getItem('itaca-show') || '';
let sceneId = '';
let editingSceneId = '';
let activeTab = '';
let readings = [];
let refreshInFlight;
let reviewingScene = false;
let recognition;
let listening = false;
const $ = (id) => document.getElementById(id);
const statuses = {
  pending: 'Pendiente', applying: 'Enviando', applied: 'Aplicado', rejected: 'Rechazado',
  stale: 'Requiere nueva lectura', expired: 'Caducado', failed: 'Revisar consola', partial: 'Aplicación parcial',
  superseded: 'Sustituida',
};
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const db = (value) => Number(value).toLocaleString('es-PE', { maximumFractionDigits: 1 }) + ' dB';
const currentShow = () => state.shows.find((show) => show.id === showId);
const showPath = () => '/api/shows/' + encodeURIComponent(showId);

function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = false;
}

async function api(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.');
  return data;
}

async function action(button, operation) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try {
    await operation();
    await refresh();
  } catch (error) {
    notice(error.message, true);
    await refresh().catch(() => {});
  } finally {
    if (button) button.disabled = false;
  }
}

async function refresh() {
  const request = (refreshInFlight || Promise.resolve()).catch(() => {}).then(() => api('/api/state')).then((data) => {
    const previousShowId = showId;
    state = data;
    if (!currentShow()) showId = state.shows[0]?.id || '';
    if (previousShowId !== showId) activeTab = '';
    localStorage.setItem('itaca-show', showId);
    render();
    if (previousShowId !== showId) resetSceneEditor();
    $('connection').textContent = 'Gestor conectado';
  }).finally(() => { if (refreshInFlight === request) refreshInFlight = undefined; });
  refreshInFlight = request;
  return request;
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-panel').forEach((panel) => { panel.hidden = panel.id !== tab; });
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.classList.toggle('selected', button.dataset.tab === tab);
    button.setAttribute('aria-current', button.dataset.tab === tab ? 'step' : 'false');
  });
}

function setShowPanel(panelId) {
  $('show-picker').hidden = panelId !== 'show-picker';
  $('show-settings').hidden = panelId !== 'show-settings';
  $('change-show').setAttribute('aria-expanded', String(panelId === 'show-picker'));
  $('manage-shows').setAttribute('aria-expanded', String(panelId === 'show-settings'));
}

function render() {
  $('show-select').innerHTML = state.shows.length
    ? state.shows.map((show) => '<option value="' + show.id + '">' + escapeHtml(show.name) + '</option>').join('')
    : '<option value="">Selecciona una obra</option>';
  $('show-select').value = showId;
  $('selected-show-name').textContent = currentShow()?.name || 'Crea tu primera obra';
  $('change-show').disabled = !state.shows.length;
  $('mode').textContent = state.mode === 'demo' ? 'DEMOSTRACIÓN' : 'CONSOLA REAL';
  $('mode').classList.toggle('live', state.mode === 'live');
  $('storage-label').textContent = state.storage === 'supabase' ? 'Datos en Supabase · control local' : 'Datos guardados en esta laptop';
  $('welcome').hidden = !!currentShow();
  $('workspace').hidden = !currentShow();
  $('show-rename').hidden = !currentShow();
  if (!currentShow()) return;
  if (!activeTab) {
    const show = currentShow();
    switchTab(!show.channels.length ? 'channels' : !show.scenes.length ? 'scenes' : 'operation');
  }
  if (document.activeElement !== $('show-rename').elements.name) {
    $('show-rename').elements.name.value = currentShow().name;
  }
  renderChannels();
  renderGuide();
  renderScenes();
  renderProposals();
  renderHistory();
}

function renderChannels() {
  $('channel-rows').innerHTML = currentShow().channels.map((channel) => {
    const reading = readings.find((item) => item.channel === channel.channel);
    return '<tr><td>' + String(channel.channel).padStart(2, '0') + '</td><td>' + escapeHtml(channel.actor) +
      '</td><td>' + escapeHtml(channel.microphone) + '</td><td>' + db(channel.minGain) + ' a ' + db(channel.maxGain) +
      '</td><td title="' + escapeHtml(reading?.error || '') + '">' + (reading?.value === undefined ? 'Sin lectura' : db(reading.value)) +
      '</td><td><button class="secondary" data-edit-channel="' + channel.channel + '">Editar</button> ' +
      '<button class="danger-text" data-delete-channel="' + channel.channel + '">Retirar</button></td></tr>';
  }).join('') || '<tr><td colspan="6" class="empty">Asigna el primer canal con el formulario.</td></tr>';
}

function changeTable(changes) {
  return '<table><thead><tr><th>Canal / actor</th><th>Actual</th><th>Propuesto</th></tr></thead><tbody>' +
    changes.map((change) => {
      const actor = currentShow().channels.find((channel) => channel.channel === change.channel)?.actor;
      return '<tr><td>' + change.channel + (actor ? ' · ' + escapeHtml(actor) : '') + '</td><td>' + db(change.before) +
        '</td><td class="gain-target">' + db(change.after) + '</td></tr>';
    }).join('') + '</tbody></table>';
}

function renderProposals() {
  const pending = state.proposals.filter((proposal) => proposal.showId === showId && proposal.status === 'pending').reverse();
  $('pending-count').textContent = pending.length;
  $('proposals').innerHTML = pending.map((proposal) =>
    '<article class="proposal"><h3>' + escapeHtml(proposal.label) + '</h3><p class="proposal-meta">' +
    (proposal.mode === 'demo' ? 'Demostración · ' : '') + 'Válida hasta ' + new Date(proposal.expiresAt).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) +
    '</p>' + changeTable(proposal.changes) + '<div class="proposal-buttons">' +
    '<button class="primary" data-confirm="' + proposal.id + '" data-review-version="' + (proposal.reviewVersion ?? 1) + '"' +
    (reviewingScene && proposal.source === 'scene' ? ' disabled' : '') + '>Confirmar cambio' + (proposal.changes.length > 1 ? 's' : '') +
    '</button><button class="secondary" data-reject="' + proposal.id + '">Rechazar</button></div></article>'
  ).join('') || '<div class="empty"><h3>Sin cambios pendientes</h3><p>Envía una instrucción o prepara una escena para revisar sus ajustes.</p></div>';
}

function renderGuide() {
  const show = currentShow();
  if (!show.scenes.some((scene) => scene.id === sceneId)) sceneId = show.activeSceneId || show.scenes[0]?.id || '';
  const scene = show.scenes.find((item) => item.id === sceneId);
  const active = show.scenes.find((item) => item.id === show.activeSceneId);
  $('active-scene').textContent = active ? 'Última escena aplicada · ' + active.name : 'Ninguna escena aplicada';
  $('guide-select').innerHTML = show.scenes.map((item, index) =>
    '<option value="' + item.id + '">' + (index + 1) + '. ' + escapeHtml(item.name) + '</option>').join('') ||
    '<option value="">Crea una escena para comenzar</option>';
  $('guide-select').value = sceneId;
  $('guide-content').innerHTML = scene
    ? '<h3 class="scene-name">' + escapeHtml(scene.name) + '</h3><p class="scene-notes">' + escapeHtml(scene.notes) +
      '</p><table><thead><tr><th>Canal</th><th>Ganancia objetivo</th></tr></thead><tbody>' +
      scene.gains.map((gain) => '<tr><td>' + gain.channel + '</td><td class="gain-target">' + db(gain.value) + '</td></tr>').join('') + '</tbody></table>'
    : '<p class="empty">Las escenas guardadas aparecerán aquí.</p>';
  const index = show.scenes.findIndex((item) => item.id === sceneId);
  $('scene-prev').disabled = index <= 0;
  $('scene-next').disabled = index < 0 || index >= show.scenes.length - 1;
  const pending = state.proposals.some((proposal) => proposal.showId === showId &&
    proposal.sceneId === sceneId && proposal.source === 'scene' && proposal.status === 'pending');
  $('propose-scene').disabled = !scene || reviewingScene;
  $('propose-scene').textContent = reviewingScene ? 'Consultando ganancias…'
    : pending ? 'Actualizar revisión de escena' : 'Revisar cambios de escena';
}

function renderScenes() {
  $('scene-list').innerHTML = currentShow().scenes.map((scene, index) =>
    '<article class="scene-row"><h3>' + (index + 1) + '. ' + escapeHtml(scene.name) + '</h3><p class="hint">' +
    scene.gains.length + (scene.gains.length === 1 ? ' canal' : ' canales') + (scene.id === currentShow().activeSceneId ? ' · Aplicada' : '') +
    '</p><div class="row-actions"><button class="secondary" data-edit-scene="' + scene.id + '">Editar</button>' +
    '<button class="secondary" data-prepare-scene="' + scene.id + '">Preparar</button>' +
    '<button class="danger-text" data-delete-scene="' + scene.id + '">Eliminar</button></div></article>'
  ).join('') || '<p class="empty">Todavía no hay escenas guardadas.</p>';
}

function resetSceneEditor(scene) {
  editingSceneId = scene?.id || '';
  const form = $('scene-form');
  form.reset();
  form.elements.name.value = scene?.name || '';
  form.elements.notes.value = scene?.notes || '';
  $('scene-form-title').textContent = scene ? 'Editar escena' : 'Crear escena';
  $('scene-gains').innerHTML = (currentShow()?.channels || []).map((channel) => {
    const gain = scene?.gains.find((item) => item.channel === channel.channel);
    const reading = readings.find((item) => item.channel === channel.channel)?.value;
    const initial = Math.min(channel.maxGain, Math.max(channel.minGain, reading ?? 0));
    return '<div class="scene-gain"><input type="checkbox" aria-label="Incluir canal ' + channel.channel + '" data-include="' +
      channel.channel + '"' + (gain ? ' checked' : '') + '><label for="scene-gain-' + channel.channel + '">Canal ' +
      channel.channel + ' · ' + escapeHtml(channel.actor) + '</label><input id="scene-gain-' + channel.channel +
      '" type="number" step="0.1" min="' + channel.minGain + '" max="' + channel.maxGain + '" value="' +
      (gain?.value ?? initial) + '" aria-label="Ganancia del canal ' + channel.channel + '"></div>';
  }).join('') || '<p class="hint">Registra primero los canales de la obra.</p>';
}

function renderHistory() {
  const proposals = state.proposals.filter((proposal) => proposal.showId === showId).reverse();
  $('history-count').textContent = proposals.length || '';
  $('history-list').innerHTML = proposals.map((proposal) =>
    '<article class="history-row"><div class="history-header"><h3>' + escapeHtml(proposal.label) + '</h3><span class="badge status-' +
    proposal.status + '">' + statuses[proposal.status] + '</span></div><p>' + new Date(proposal.createdAt).toLocaleString('es-PE') +
    (proposal.mode === 'demo' ? ' · Demostración' : ' · Consola real') + '</p><p>' +
    proposal.changes.map((change) => 'Canal ' + change.channel + ' · ' + db(change.before) + ' → ' + db(change.after)).join(' / ') +
    '</p>' + (proposal.message ? '<p>' + escapeHtml(proposal.message) + '</p>' : '') +
    ((proposal.status === 'applied' || proposal.status === 'partial') && proposal.applied.length && !proposal.undoneBy && proposal.source !== 'undo'
      ? '<button class="secondary" data-undo="' + proposal.id + '">Proponer deshacer</button>' : '') + '</article>'
  ).join('') || '<p class="empty">Las decisiones aparecerán aquí.</p>';
}

async function confirmDelete(message) {
  $('delete-message').textContent = message;
  $('delete-dialog').showModal();
  return new Promise((resolve) => $('delete-dialog').addEventListener('close', () => {
    resolve($('delete-dialog').returnValue === 'confirm');
  }, { once: true }));
}

document.querySelectorAll('[data-tab], [data-go-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    switchTab(button.dataset.tab || button.dataset.goTab);
    if (button.dataset.goTab) {
      const selected = document.querySelector('[data-tab].selected');
      selected.focus({ preventScroll: true });
      selected.scrollIntoView({ block: 'start' });
    }
  });
});
$('change-show').addEventListener('click', () => {
  setShowPanel($('show-picker').hidden ? 'show-picker' : null);
  if (!$('show-picker').hidden) $('show-select').focus();
});
$('manage-shows').addEventListener('click', () => {
  setShowPanel($('show-settings').hidden ? 'show-settings' : null);
});
$('show-select').addEventListener('change', (event) => {
  showId = event.target.value;
  activeTab = '';
  localStorage.setItem('itaca-show', showId);
  sceneId = '';
  readings = [];
  $('channel-form').reset();
  render();
  resetSceneEditor();
  setShowPanel(null);
  $('change-show').focus();
});
$('welcome-create').addEventListener('click', () => {
  setShowPanel('show-settings');
  $('show-create').elements.name.focus();
});
$('show-create').addEventListener('submit', (event) => {
  event.preventDefault();
  void action(event.submitter, async () => {
    const show = await api('/api/shows', 'POST', { name: event.target.elements.name.value });
    showId = show.id;
    readings = [];
    sceneId = '';
    event.target.reset();
    setShowPanel(null);
    notice('Obra creada. Asigna sus canales para comenzar.');
    switchTab('channels');
  });
});
$('show-rename').addEventListener('submit', (event) => {
  event.preventDefault();
  void action(event.submitter, async () => { await api(showPath(), 'PATCH', { name: event.target.elements.name.value }); notice('Nombre actualizado.'); });
});
$('show-delete').addEventListener('click', (event) => {
  void action(event.currentTarget, async () => {
    if (await confirmDelete('Se eliminará la obra y sus escenas. El historial se conserva.')) {
      await api(showPath(), 'DELETE'); readings = []; sceneId = ''; notice('Obra eliminada.');
    }
  });
});
$('channel-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  void action(event.submitter, async () => {
    await api(showPath() + '/channels', 'PUT', {
      channel: Number(form.elements.channel.value), actor: form.elements.actor.value, microphone: form.elements.microphone.value,
      minGain: Number(form.elements.minGain.value), maxGain: Number(form.elements.maxGain.value),
    });
    await refresh();
    resetSceneEditor();
    notice('Asignación y límites guardados.');
  });
});
$('channel-reset').addEventListener('click', () => { $('channel-form').reset(); $('channel-form-title').textContent = 'Asignar un canal'; });
$('read-gains').addEventListener('click', (event) => {
  void action(event.currentTarget, async () => {
    readings = await api(showPath() + '/gains');
    notice(readings.some((reading) => reading.error) ? 'Hay canales sin lectura. Revisa la conexión con la consola.' : 'Ganancias actualizadas.', readings.some((reading) => reading.error));
  });
});
$('new-scene').addEventListener('click', () => { resetSceneEditor(); $('scene-form').elements.name.focus(); });
$('scene-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const gains = [...$('scene-gains').querySelectorAll('input[type=checkbox]:checked')].map((input) =>
    ({ channel: Number(input.dataset.include), value: Number($('scene-gain-' + input.dataset.include).value) }));
  void action(event.submitter, async () => {
    const saved = await api(showPath() + '/scenes' + (editingSceneId ? '/' + editingSceneId : ''), editingSceneId ? 'PUT' : 'POST', {
      name: event.target.elements.name.value, notes: event.target.elements.notes.value, gains,
    });
    sceneId = saved.id;
    await refresh();
    resetSceneEditor();
    notice('Escena guardada.');
  });
});
$('guide-select').addEventListener('change', (event) => { sceneId = event.target.value; renderGuide(); });
for (const [id, offset] of [['scene-prev', -1], ['scene-next', 1]]) {
  $(id).addEventListener('click', () => {
    const scenes = currentShow().scenes;
    const next = scenes[scenes.findIndex((scene) => scene.id === sceneId) + offset];
    if (next) { sceneId = next.id; renderGuide(); }
  });
}
$('guide-expand').addEventListener('click', (event) => {
  const expanded = document.body.classList.toggle('guide-expanded');
  event.currentTarget.textContent = expanded ? 'Reducir' : 'Ampliar';
});
$('propose-scene').addEventListener('click', (event) => {
  if (reviewingScene) return;
  reviewingScene = true;
  void action(event.currentTarget, async () => {
    renderGuide();
    renderProposals();
    await api(showPath() + '/scenes/' + sceneId + '/propose', 'POST');
    notice('Revisión actualizada. Comprueba los valores y confirma la escena.');
  }).finally(() => {
    reviewingScene = false;
    if (currentShow()) {
      renderGuide();
      renderProposals();
    }
  });
});
async function proposeText(button) {
  await action(button, async () => {
    if (!showId) throw new Error('Crea y selecciona una obra primero.');
    await api(showPath() + '/commands', 'POST', { text: $('command-text').value });
    notice('Propuesta creada. Revisa el cambio antes de confirmar.');
    switchTab('operation');
  });
}
$('command-form').addEventListener('submit', (event) => { event.preventDefault(); void proposeText(event.submitter); });

document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const data = button.dataset;
  if (data.editChannel) {
    const channel = currentShow().channels.find((item) => item.channel === Number(data.editChannel));
    const form = $('channel-form');
    for (const [name, value] of Object.entries(channel)) form.elements.namedItem(name).value = value;
    $('channel-form-title').textContent = 'Editar canal ' + channel.channel;
    form.elements.actor.focus();
  }
  if (data.editScene) {
    resetSceneEditor(currentShow().scenes.find((scene) => scene.id === data.editScene));
    $('scene-form').elements.name.focus();
  }
  if (data.prepareScene) { sceneId = data.prepareScene; renderGuide(); switchTab('operation'); }
  if (data.deleteChannel) void action(button, async () => {
    if (await confirmDelete('¿Retirar este canal de la obra?')) {
      await api(showPath() + '/channels/' + data.deleteChannel, 'DELETE');
      await refresh(); resetSceneEditor();
    }
  });
  if (data.deleteScene) void action(button, async () => {
    if (await confirmDelete('¿Eliminar esta escena de la obra?')) {
      await api(showPath() + '/scenes/' + data.deleteScene, 'DELETE');
      await refresh(); resetSceneEditor();
    }
  });
  if (data.confirm || data.reject || data.undo) void action(button, async () => {
    const id = data.confirm || data.reject || data.undo;
    const operation = data.confirm ? 'confirm' : data.reject ? 'reject' : 'undo';
    const proposal = await api('/api/proposals/' + id + '/' + operation, 'POST',
      operation === 'confirm' ? { reviewVersion: Number(data.reviewVersion) } : undefined);
    if (operation === 'confirm') readings = [];
    notice(proposal.message || (operation === 'undo' ? 'Revisa la propuesta para deshacer.' : 'Propuesta rechazada.'),
      ['partial', 'failed'].includes(proposal.status));
    if (operation === 'undo') switchTab('operation');
  });
});

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Recognition && window.isSecureContext) {
  recognition = new Recognition();
  recognition.lang = 'es-ES';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    $('command-text').value = event.results[event.results.length - 1][0].transcript;
    void proposeText($('propose-command'));
  };
  recognition.onerror = (event) => notice('No se pudo reconocer la voz (' + event.error + '). Puedes escribir la instrucción.', true);
  recognition.onend = () => { listening = false; $('listen').textContent = 'Activar micrófono'; };
} else {
  $('listen').disabled = true;
  $('voice-hint').textContent = !window.isSecureContext
    ? 'El micrófono requiere HTTPS o localhost. Puedes enviar instrucciones por texto desde esta conexión.'
    : 'Este navegador no ofrece reconocimiento de voz. Puedes escribir las instrucciones.';
}
$('listen').addEventListener('click', () => {
  try {
    if (!showId) throw new Error('Crea una obra y registra sus canales primero.');
    if (listening) recognition.stop();
    else { recognition.start(); listening = true; $('listen').textContent = 'Escuchando… Detener'; }
  } catch (error) { notice(error.message, true); }
});

function connectEvents() {
  const socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  socket.onmessage = () => { void refresh().catch((error) => notice(error.message, true)); };
  socket.onerror = () => socket.close();
  socket.onclose = () => {
    $('connection').textContent = 'Reconectando con el gestor…';
    setTimeout(connectEvents, 3000);
  };
}
void refresh().then(() => { resetSceneEditor(); connectEvents(); }).catch((error) => notice(error.message, true));
setInterval(() => {
  if (currentShow() && state.proposals.some((proposal) => proposal.status === 'pending' && Date.parse(proposal.expiresAt) <= Date.now())) {
    void refresh().catch(() => {});
  }
}, 1000);
