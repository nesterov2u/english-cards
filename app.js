const $ = (selector) => document.querySelector(selector);
const DEFAULT_CONFIG = {
  url: 'https://kxpzkdrfsjusaeeipssg.supabase.co',
  key: 'sb_publishable_2Qw0ubk0lUuOuszN0cqdPA_x_m3HZYx',
};
const LEGACY_DEFAULT_CONFIG = {
  url: DEFAULT_CONFIG.url,
  key: 'sb_publishable_2Qw0ubk0IUu0uszN0cqdPA_x_m3HZYx',
};
const savedConfig = JSON.parse(localStorage.getItem('wordGardenConfig') || 'null');
const config = savedConfig?.url === LEGACY_DEFAULT_CONFIG.url && savedConfig?.key === LEGACY_DEFAULT_CONFIG.key ? DEFAULT_CONFIG : savedConfig || DEFAULT_CONFIG;
const PAGE_SIZE = 60;
const state = { cards: [], studyCards: null, totalCards: 0, isLoadingMore: false, currentIndex: null, recentStudyIds: [], config };

function apiHeaders() { return { apikey: state.config.key, Authorization: `Bearer ${state.config.key}`, 'Content-Type': 'application/json' }; }
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
  state.cards = []; state.studyCards = null; state.totalCards = 0; state.currentIndex = null; state.recentStudyIds = [];
  if (!state.config.url || !state.config.key) return render();
  try { await loadMoreCards(); $('#sync-status').textContent = 'Общая база подключена'; }
  catch (error) { $('#sync-status').textContent = error.message; }
  render();
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
  try {
    state.studyCards = await request('cards?select=*&order=created_at.desc');
    state.currentIndex = null; state.recentStudyIds = [];
    if (state.studyCards.length) chooseStudyCard();
  } catch (error) { $('#study-empty').textContent = error.message; }
  render();
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
  $('#library-title').innerHTML = state.totalCards ? 'Моя коллекция' : 'Добавьте слово,<br />остальное найдём сами.';
  $('#empty-state').style.display = state.totalCards ? 'none' : 'block';
  $('#cards-list').innerHTML = state.cards.map(card => `<article class="word-card"><button class="remove" data-id="${card.id}" aria-label="Удалить">×</button><h2>${escapeHtml(card.word)}</h2><p class="translation">${escapeHtml(card.translation)}</p><p class="definition">${escapeHtml(card.definition || '')}</p></article>`).join('');
  $('#load-more').hidden = state.cards.length >= state.totalCards || state.totalCards === 0;
  $('#load-more').disabled = state.isLoadingMore;
  $('#load-more').textContent = state.isLoadingMore ? 'Загружаем…' : 'Показать ещё';
  const card = state.studyCards?.[state.currentIndex];
  $('#study-empty').style.display = card ? 'none' : 'block'; $('#flashcard').classList.toggle('has-card', !!card);
  if (card) { const definition = card.definition || ''; $('#study-word').textContent = card.word; $('#study-phonetic').textContent = card.phonetic || ''; $('#study-translation').textContent = card.translation; $('#study-definition').textContent = definition; $('#card-back').classList.toggle('has-long-definition', definition.length > 110); fitStudyHeading($('#study-word')); fitStudyHeading($('#study-translation')); setCardFlipped(false); }
}
function setCardFlipped(isFlipped) {
  $('#flashcard').classList.toggle('is-flipped', isFlipped);
  $('#card-front').setAttribute('aria-hidden', String(isFlipped));
  $('#card-back').setAttribute('aria-hidden', String(!isFlipped));
  $('#flashcard').setAttribute('aria-label', isFlipped ? 'Показать следующую карточку' : 'Показать перевод');
}
function switchView(name) { document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('is-active', tab.dataset.view === name)); document.querySelectorAll('.view').forEach(view => view.classList.toggle('is-active', view.id === `${name}-view`)); if (name === 'study' && state.totalCards) loadStudyCards(); }
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
  return { translation: translationResponse, definition, example: meaning?.example || '', phonetic: dictionary?.[0]?.phonetic || dictionary?.[0]?.phonetics?.find(item => item.text)?.text || '' };
}
$('.tabs').addEventListener('click', event => { const tab = event.target.closest('.tab'); if (tab) switchView(tab.dataset.view); });
$('#load-more').onclick = () => loadMoreCards().catch(error => alert(error.message));
$('#open-add').onclick = () => { if (!state.config.url) { switchView('settings'); return; } $('#word-form').reset(); $('#save-word').disabled = true; $('#auto-fields').classList.remove('show'); $('#add-dialog').showModal(); $('#word-input').focus(); };
$('.close').onclick = () => $('#add-dialog').close();
$('#word-input').addEventListener('change', async event => { const word = event.target.value.trim(); if (!word) return; $('#save-word').disabled = true; $('#lookup-loading').classList.add('show'); try { const data = await lookup(word); $('#translation-input').value = data.translation; $('#definition-input').value = data.definition; $('#example-input').value = data.example; $('#auto-fields').classList.add('show'); $('#word-form').dataset.phonetic = data.phonetic; $('#save-word').disabled = false; } catch (error) { $('#auto-fields').classList.add('show'); $('#save-word').disabled = false; alert(`${error.message} Заполните перевод вручную.`); } finally { $('#lookup-loading').classList.remove('show'); } });
$('#word-form').addEventListener('submit', async event => { event.preventDefault(); const card = { word: $('#word-input').value.trim(), translation: $('#translation-input').value.trim(), definition: $('#definition-input').value.trim(), example: $('#example-input').value.trim(), phonetic: $('#word-form').dataset.phonetic || '' }; try { const result = await request('cards', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(card) }); state.cards.unshift(result[0]); if (state.cards.length > PAGE_SIZE) state.cards.pop(); state.totalCards += 1; if (state.studyCards) state.studyCards.unshift(result[0]); $('#add-dialog').close(); render(); } catch (error) { alert(error.message); } });
$('#cards-list').addEventListener('click', async event => { const button = event.target.closest('.remove'); if (!button || !confirm('Удалить карточку?')) return; try { await request(`cards?id=eq.${button.dataset.id}`, { method: 'DELETE' }); state.cards = state.cards.filter(card => card.id !== button.dataset.id); state.totalCards = Math.max(0, state.totalCards - 1); if (state.studyCards) { state.studyCards = state.studyCards.filter(card => card.id !== button.dataset.id); if (state.currentIndex >= state.studyCards.length) state.currentIndex = null; } render(); } catch (error) { alert(error.message); } });
function chooseStudyCard() {
  const historySize = Math.min(3, state.studyCards.length - 1);
  const recentIds = new Set(historySize ? state.recentStudyIds.slice(-historySize) : []);
  const availableCards = state.studyCards.filter(card => !recentIds.has(card.id));
  const card = availableCards[Math.floor(Math.random() * availableCards.length)];
  state.currentIndex = state.studyCards.findIndex(item => item.id === card.id);
  state.recentStudyIds = [...state.recentStudyIds, card.id].slice(-3);
}
function nextStudyCard() { chooseStudyCard(); render(); }
$('#flashcard').onclick = () => $('#flashcard').classList.contains('is-flipped') ? nextStudyCard() : setCardFlipped(true); $('#flashcard').onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setCardFlipped(!$('#flashcard').classList.contains('is-flipped')); } };
$('#supabase-url').value = state.config.url || ''; $('#supabase-key').value = state.config.key || ''; $('#save-settings').onclick = () => { state.config = { url: $('#supabase-url').value.replace(/\/$/, ''), key: $('#supabase-key').value.trim() }; localStorage.setItem('wordGardenConfig', JSON.stringify(state.config)); loadCards(); switchView('library'); };
loadCards();
