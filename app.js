const $ = (selector) => document.querySelector(selector);
const state = { cards: [], currentIndex: 0, config: JSON.parse(localStorage.getItem('wordGardenConfig') || '{}') };

function apiHeaders() { return { apikey: state.config.key, Authorization: `Bearer ${state.config.key}`, 'Content-Type': 'application/json' }; }
async function request(path, options = {}) {
  if (!state.config.url || !state.config.key) throw new Error('Подключите Supabase в настройках.');
  let response;
  try {
    response = await fetch(`${state.config.url}/rest/v1/${path}`, { ...options, headers: { ...apiHeaders(), ...options.headers } });
  } catch {
    throw new Error('Не удалось найти проект Supabase. Проверьте URL проекта.');
  }
  if (response.status === 401 || response.status === 403) throw new Error('Supabase отклонил ключ. Вставьте publishable/anon key из Settings → API.');
  if (response.status === 404) throw new Error('Таблица карточек не создана. Выполните supabase/schema.sql в SQL Editor.');
  if (!response.ok) throw new Error('Supabase пока недоступен. Проверьте настройки проекта.');
  return response.status === 204 ? null : response.json();
}
async function loadCards() {
  if (!state.config.url || !state.config.key) return render();
  try { state.cards = await request('cards?select=*&order=created_at.desc'); $('#sync-status').textContent = 'Общая база подключена'; }
  catch (error) { $('#sync-status').textContent = error.message; }
  render();
}
function escapeHtml(text = '') { const element = document.createElement('span'); element.textContent = text; return element.innerHTML; }
function render() {
  $('#word-count').textContent = state.cards.length;
  $('#library-view').classList.toggle('has-cards', state.cards.length > 0);
  $('#library-title').innerHTML = state.cards.length ? 'Моя коллекция' : 'Добавьте слово,<br />остальное найдём сами.';
  $('#empty-state').style.display = state.cards.length ? 'none' : 'block';
  $('#cards-list').innerHTML = state.cards.map(card => `<article class="word-card"><button class="remove" data-id="${card.id}" aria-label="Удалить">×</button><h2>${escapeHtml(card.word)}</h2><p class="translation">${escapeHtml(card.translation)}</p><p class="definition">${escapeHtml(card.definition || '')}</p></article>`).join('');
  const card = state.cards[state.currentIndex];
  $('#study-empty').style.display = card ? 'none' : 'block'; $('#flashcard').classList.toggle('has-card', !!card); $('#next-card').style.display = card ? 'block' : 'none';
  if (card) { $('#study-word').textContent = card.word; $('#study-phonetic').textContent = card.phonetic || ''; $('#study-translation').textContent = card.translation; $('#study-definition').textContent = card.definition || ''; setCardFlipped(false); }
}
function setCardFlipped(isFlipped) {
  $('#flashcard').classList.toggle('is-flipped', isFlipped);
  $('#card-front').setAttribute('aria-hidden', String(isFlipped));
  $('#card-back').setAttribute('aria-hidden', String(!isFlipped));
  $('#flashcard').setAttribute('aria-label', isFlipped ? 'Показать следующую карточку' : 'Показать перевод');
}
function switchView(name) { document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('is-active', tab.dataset.view === name)); document.querySelectorAll('.view').forEach(view => view.classList.toggle('is-active', view.id === `${name}-view`)); if (name === 'study' && state.cards.length) setCardFlipped(false); }
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
$('#open-add').onclick = () => { if (!state.config.url) { switchView('settings'); return; } $('#word-form').reset(); $('#save-word').disabled = true; $('#auto-fields').classList.remove('show'); $('#add-dialog').showModal(); $('#word-input').focus(); };
$('.close').onclick = () => $('#add-dialog').close();
$('#word-input').addEventListener('change', async event => { const word = event.target.value.trim(); if (!word) return; $('#save-word').disabled = true; $('#lookup-loading').classList.add('show'); try { const data = await lookup(word); $('#translation-input').value = data.translation; $('#definition-input').value = data.definition; $('#example-input').value = data.example; $('#auto-fields').classList.add('show'); $('#word-form').dataset.phonetic = data.phonetic; $('#save-word').disabled = false; } catch (error) { $('#auto-fields').classList.add('show'); $('#save-word').disabled = false; alert(`${error.message} Заполните перевод вручную.`); } finally { $('#lookup-loading').classList.remove('show'); } });
$('#word-form').addEventListener('submit', async event => { event.preventDefault(); const card = { word: $('#word-input').value.trim(), translation: $('#translation-input').value.trim(), definition: $('#definition-input').value.trim(), example: $('#example-input').value.trim(), phonetic: $('#word-form').dataset.phonetic || '' }; try { const result = await request('cards', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(card) }); state.cards.unshift(result[0]); $('#add-dialog').close(); render(); } catch (error) { alert(error.message); } });
$('#cards-list').addEventListener('click', async event => { const button = event.target.closest('.remove'); if (!button || !confirm('Удалить карточку?')) return; try { await request(`cards?id=eq.${button.dataset.id}`, { method: 'DELETE' }); state.cards = state.cards.filter(card => card.id !== button.dataset.id); render(); } catch (error) { alert(error.message); } });
function nextStudyCard() {
  setCardFlipped(false);
  if (state.cards.length > 1) {
    const offset = 1 + Math.floor(Math.random() * (state.cards.length - 1));
    state.currentIndex = (state.currentIndex + offset) % state.cards.length;
  }
  render();
}
$('#flashcard').onclick = () => $('#flashcard').classList.contains('is-flipped') ? nextStudyCard() : setCardFlipped(true); $('#flashcard').onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('#flashcard').click(); } }; $('#next-card').onclick = nextStudyCard;
$('#supabase-url').value = state.config.url || ''; $('#supabase-key').value = state.config.key || ''; $('#save-settings').onclick = () => { state.config = { url: $('#supabase-url').value.replace(/\/$/, ''), key: $('#supabase-key').value.trim() }; localStorage.setItem('wordGardenConfig', JSON.stringify(state.config)); loadCards(); switchView('library'); };
loadCards();
