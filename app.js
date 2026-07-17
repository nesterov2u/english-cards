const $ = (selector) => document.querySelector(selector);
const DEFAULT_CONFIG = {
  url: 'https://kxpzkdrfsjusaeeipssg.supabase.co',
  key: 'sb_publishable_2Qw0ubk0lUuOuszN0cqdPA_x_m3HZYx',
};
const config = DEFAULT_CONFIG;
const PAGE_SIZE = 60;
const STUDY_PROMPTS = ['Одно слово — уже шаг.', 'Повторение делает сильнее.', 'Учите в своём ритме.', 'Небольшой шаг, большой словарь.', 'Сегодня слово — завтра уверенность.', 'Продолжайте, вы справляетесь.'];
const state = { cards: [], studyCards: null, totalCards: 0, isLoadingMore: false, isStudyLoading: false, currentIndex: null, recentStudyIds: [], config };
let ignoreFlashcardClickUntil = 0;
let studyLoadPromise = null;

function apiHeaders() { return { apikey: state.config.key, Authorization: `Bearer ${state.config.key}`, 'Content-Type': 'application/json' }; }
function setSyncStatus(isConnected, message) { $('#sync-status').classList.toggle('is-connected', isConnected); $('#sync-status').classList.toggle('is-disconnected', !isConnected); $('#sync-status').setAttribute('aria-label', message); $('#sync-status').title = message; }
function setAppLoading(isLoading) { $('#app-loader').classList.toggle('is-hidden', !isLoading); $('#app-loader').setAttribute('aria-hidden', String(!isLoading)); }
async function request(path, options = {}) {
  const { withCount = false, ...requestOptions } = options;
  if (!state.config.url || !state.config.key) throw new Error('Подключите Supabase в настройках.');
  let response;
  try {
    response = await fetch(`${state.config.url}/rest/v1/${path}`, { ...requestOptions, headers: { ...apiHeaders(), ...requestOptions.headers } });
  } catch {
    throw new Error('Не удалось найти проект Supabase. Проверьте URL проекта.');
  }
  if (response.status === 401 || response.status === 403) throw new Error('Supabase отклонил ключ. Вставьте publishable/anon key из Settings → API.');
  if (response.status === 404) throw new Error('Таблица карточек не создана. Выполните supabase/schema.sql в SQL Editor.');
  if (!response.ok) throw new Error('Supabase пока недоступен. Проверьте настройки проекта.');
  const data = response.status === 204 ? null : await response.json();
  if (!withCount) return data;
  const total = Number(response.headers.get('content-range')?.split('/')[1]);
  return { data, total: Number.isFinite(total) ? total : 0 };
}
async function loadCards() {
  setAppLoading(true);
  state.cards = []; state.studyCards = null; state.totalCards = 0; state.currentIndex = null; state.recentStudyIds = [];
  if (!state.config.url || !state.config.key) { render(); setAppLoading(false); return; }
  try { await loadMoreCards(); setSyncStatus(true, 'Общая база подключена'); }
  catch (error) { setSyncStatus(false, error.message); }
  render(); setAppLoading(false);
}
async function loadMoreCards() {
  if (state.isLoadingMore || state.cards.length >= state.totalCards && state.totalCards !== 0) return;
  state.isLoadingMore = true; render();
  try {
    const start = state.cards.length;
    const { data, total } = await request('cards?select=*&order=created_at.desc', { withCount: true, headers: { Range: `${start}-${start + PAGE_SIZE - 1}`, Prefer: 'count=exact' } });
    state.cards.push(...data); state.totalCards = total;
  } finally { state.isLoadingMore = false; render(); }
}
async function loadStudyCards() {
  if (state.studyCards) { chooseStudyCard(); render(); return; }
  if (state.cards.length) {
    state.studyCards = [...state.cards];
    state.currentIndex = null; state.recentStudyIds = [];
    chooseStudyCard(); render();
    return;
  }
  if (studyLoadPromise) return studyLoadPromise;
  state.isStudyLoading = true; render();
  studyLoadPromise = (async () => {
    try {
      state.studyCards = await request('cards?select=*&order=created_at.desc');
      state.currentIndex = null; state.recentStudyIds = [];
      if (state.studyCards.length) chooseStudyCard();
    } catch (error) { $('#study-empty').textContent = error.message; }
    finally { state.isStudyLoading = false; studyLoadPromise = null; render(); }
  })();
  return studyLoadPromise;
}
function escapeHtml(text = '') { const element = document.createElement('span'); element.textContent = text; return element.innerHTML; }
function fitStudyHeading(element) {
  element.style.fontSize = '';
  const availableWidth = element.parentElement.clientWidth - 70;
  const naturalWidth = element.scrollWidth;
  if (naturalWidth > availableWidth) {
    const fontSize = parseFloat(getComputedStyle(element).fontSize);
    element.style.fontSize = `${Math.max(18, Math.floor(fontSize * availableWidth / naturalWidth))}px`;
  }
}
function render() {
  $('#word-count').textContent = state.totalCards;
  $('#library-view').classList.toggle('has-cards', state.totalCards > 0);
  $('#library-title').innerHTML = state.totalCards ? 'Мой словарь' : 'Добавьте слово,<br />остальное найдём сами.';
  $('#empty-state').style.display = state.totalCards ? 'none' : 'block';
  $('#cards-list').innerHTML = state.cards.map(card => `<article class="word-card"><button class="edit" data-id="${card.id}" aria-label="Редактировать"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.4-1 10.1-10.1a2.1 2.1 0 0 0-3-3L5.4 15.9 4 20Z" /><path d="m13.9 7.5 3 3" /></svg></button><button class="remove" data-id="${card.id}" aria-label="Удалить">×</button><h2>${escapeHtml(card.word)}</h2><p class="translation">${escapeHtml(card.translation)}</p><p class="definition">${escapeHtml(card.definition || '')}</p></article>`).join('');
  $('#load-more').hidden = state.cards.length >= state.totalCards || state.totalCards === 0;
  $('#load-more').disabled = state.isLoadingMore;
  $('#load-more').textContent = state.isLoadingMore ? 'Загружаем…' : 'Показать ещё';
  const card = state.studyCards?.[state.currentIndex];
  $('#study-loader').hidden = !state.isStudyLoading || !!card;
  $('#study-empty').style.display = card || state.isStudyLoading ? 'none' : 'block'; $('#flashcard').classList.toggle('has-card', !!card);
  if (card) { const definition = card.definition || ''; $('#study-word').textContent = card.word; $('#study-phonetic').textContent = card.phonetic || ''; $('#study-translation').textContent = card.translation; $('#study-definition').textContent = definition; $('#card-back').classList.toggle('has-long-definition', definition.length > 110); fitStudyHeading($('#study-word')); fitStudyHeading($('#study-translation')); setCardFlipped(false); }
}
function setCardFlipped(isFlipped) {
  $('#flashcard').classList.toggle('is-flipped', isFlipped);
  $('#card-front').setAttribute('aria-hidden', String(isFlipped));
  $('#card-back').setAttribute('aria-hidden', String(!isFlipped));
  $('#flashcard').setAttribute('aria-label', isFlipped ? 'Показать следующую карточку' : 'Показать перевод');
}
function setStudyPrompt() { $('#study-prompt').textContent = STUDY_PROMPTS[Math.floor(Math.random() * STUDY_PROMPTS.length)]; }
function switchView(name) { document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('is-active', tab.dataset.view === name)); document.querySelectorAll('.view').forEach(view => view.classList.toggle('is-active', view.id === `${name}-view`)); if (name === 'study') { setStudyPrompt(); if (state.totalCards) loadStudyCards(); } }
async function lookup(word) {
  const getTranslation = async (text) => {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.search = new URLSearchParams({ q: text, langpair: 'en|ru', mt: '1' });
    const response = await fetch(url);
    if (!response.ok) throw new Error('Перевод не получен.');
    const data = await response.json();
    return data.responseData?.translatedText || '';
  };
  const [translationResponse, dictionaryResponse] = await Promise.all([
    getTranslation(word), fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
  ]);
  let dictionary = null;
  if (dictionaryResponse.ok) dictionary = await dictionaryResponse.json();
  const meaning = dictionary?.[0]?.meanings?.[0]?.definitions?.[0];
  const definition = meaning?.definition ? await getTranslation(meaning.definition) : '';
  return { translation: translationResponse, definition, phonetic: dictionary?.[0]?.phonetic || dictionary?.[0]?.phonetics?.find(item => item.text)?.text || '' };
}
$('.tabs').addEventListener('click', event => { const tab = event.target.closest('.tab'); if (tab) switchView(tab.dataset.view); });
$('#load-more').onclick = () => loadMoreCards().catch(error => alert(error.message));
function openCardDialog(card = null) {
  const isEditing = Boolean(card);
  $('#word-form').reset(); $('#word-form').dataset.editingId = card?.id || ''; $('#word-form').dataset.phonetic = card?.phonetic || '';
  $('#dialog-eyebrow').textContent = isEditing ? 'Редактирование карточки' : 'Новая карточка';
  $('#dialog-title').textContent = isEditing ? 'Измените карточку' : 'Что сегодня учим?';
  $('#save-word').textContent = isEditing ? 'Сохранить изменения' : 'Сохранить карточку';
  $('#auto-fields').classList.toggle('show', isEditing); $('#save-word').disabled = !isEditing;
  if (card) { $('#word-input').value = card.word; $('#translation-input').value = card.translation; $('#definition-input').value = card.definition || ''; }
  $('#add-dialog').showModal(); $('#word-input').focus();
}
$('#open-add').onclick = () => openCardDialog();
$('.close').onclick = () => $('#add-dialog').close();
$('#word-input').addEventListener('change', async event => { const word = event.target.value.trim(); if (!word) return; $('#save-word').disabled = true; $('#lookup-loading').classList.add('show'); try { const data = await lookup(word); $('#translation-input').value = data.translation; $('#definition-input').value = data.definition; $('#auto-fields').classList.add('show'); $('#word-form').dataset.phonetic = data.phonetic; $('#save-word').disabled = false; } catch (error) { $('#auto-fields').classList.add('show'); $('#save-word').disabled = false; alert(`${error.message} Заполните перевод вручную.`); } finally { $('#lookup-loading').classList.remove('show'); } });
$('#word-form').addEventListener('submit', async event => { event.preventDefault(); const card = { word: $('#word-input').value.trim(), translation: $('#translation-input').value.trim(), definition: $('#definition-input').value.trim(), phonetic: $('#word-form').dataset.phonetic || '' }; const editingId = $('#word-form').dataset.editingId; try { const result = await request(editingId ? `cards?id=eq.${editingId}` : 'cards', { method: editingId ? 'PATCH' : 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(card) }); const savedCard = result?.[0]; if (!savedCard) throw new Error(editingId ? 'Не удалось обновить карточку. В базе нужно разрешить изменение карточек.' : 'Не удалось сохранить карточку.'); if (editingId) { state.cards = state.cards.map(item => item.id === editingId ? savedCard : item); if (state.studyCards) state.studyCards = state.studyCards.map(item => item.id === editingId ? savedCard : item); } else { state.cards.unshift(savedCard); if (state.cards.length > PAGE_SIZE) state.cards.pop(); state.totalCards += 1; if (state.studyCards) state.studyCards.unshift(savedCard); } $('#add-dialog').close(); render(); } catch (error) { alert(error.message); } });
$('#cards-list').addEventListener('click', async event => { const editButton = event.target.closest('.edit'); if (editButton) { openCardDialog(state.cards.find(card => card.id === editButton.dataset.id)); return; } const button = event.target.closest('.remove'); if (!button || !confirm('Удалить карточку?')) return; try { await request(`cards?id=eq.${button.dataset.id}`, { method: 'DELETE' }); state.cards = state.cards.filter(card => card.id !== button.dataset.id); state.totalCards = Math.max(0, state.totalCards - 1); if (state.studyCards) { state.studyCards = state.studyCards.filter(card => card.id !== button.dataset.id); if (state.currentIndex >= state.studyCards.length) state.currentIndex = null; } render(); } catch (error) { alert(error.message); } });
function chooseStudyCard() {
  const historySize = Math.min(3, state.studyCards.length - 1);
  const recentIds = new Set(historySize ? state.recentStudyIds.slice(-historySize) : []);
  const availableCards = state.studyCards.filter(card => !recentIds.has(card.id));
  const card = availableCards[Math.floor(Math.random() * availableCards.length)];
  state.currentIndex = state.studyCards.findIndex(item => item.id === card.id);
  state.recentStudyIds = [...state.recentStudyIds, card.id].slice(-3);
}
function nextStudyCard() { chooseStudyCard(); render(); }
function activateFlashcard() { if (!$('#flashcard').classList.contains('has-card')) return; $('#flashcard').classList.contains('is-flipped') ? nextStudyCard() : setCardFlipped(true); }
$('#flashcard').onclick = () => { if (Date.now() < ignoreFlashcardClickUntil) return; activateFlashcard(); };
document.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.code !== 'Space') return;
  if ($('#add-dialog').open || event.target.closest('input, textarea, select, button, [contenteditable="true"]')) return;
  event.preventDefault();
  if (event.repeat) return;
  ignoreFlashcardClickUntil = Date.now() + 250;
  activateFlashcard();
});
loadCards();
