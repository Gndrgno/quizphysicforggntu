// js/game_process.js
// Важные правки:
// - Надёжная синхронизация времени с сервером (offset)
// - Клиентские UI реакции теперь реагируют на server timestamps и на поле questionPhase,
//   при переходе в 'revealing' вызываем revealAnswersUI прямо из session-сабскрипта.
// - Улучшены уведомления (большой баннер под счётчиком) и компактные чармы над таймером.
// - Исправлены финальные карточки: корректный SVG кубков + стилизация очков.
// - Удалён блок с общим счётом/временем у игрока.
// Функционал взаимодействия с Firestore (через wrapper window.fb) сохранён.

// Configurable durations (seconds)
const ANSWER_DURATION = 10;
const REVEAL_DURATION = 1.5;
const WAITING_DURATION = 5;

function waitForFirebaseReady(timeout = 20000) {
  return new Promise((resolve) => {
    if (window.__FIREBASE_READY__) return resolve(true);
    const onReady = () => { window.removeEventListener('firebase-ready', onReady); resolve(!!window.__FIREBASE_READY__); };
    window.addEventListener('firebase-ready', onReady);
    setTimeout(() => { window.removeEventListener('firebase-ready', onReady); resolve(!!window.__FIREBASE_READY__); }, timeout);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const ready = await waitForFirebaseReady();
  if (!ready) {
    console.error('Firebase не доступен: убедитесь, что configure.js загружен раньше game_process.js');
    return;
  }

  const fb = window.fb;
  const db = window.db;
  const { collection, doc, getDoc, setDoc, updateDoc, onSnapshot, getDocs, query, where, serverTimestamp } = fb;
  const increment = fb.increment || (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue && window.firebase.firestore.FieldValue.increment);

  // DOM nodes
  const nodes = {
    adminCard: document.getElementById('adminGameControls'),
    quizTitleAdmin: document.getElementById('quizTitleAdmin'),
    questionTextAdmin: document.getElementById('questionTextAdmin'),
    progressBarAdmin: document.getElementById('progressBarAdmin'),
    timerAdmin: document.getElementById('timerAdmin'),
    waitingBlockAdmin: document.getElementById('waitingBlockAdmin'),
    waitingProgressBarAdmin: document.getElementById('waitingProgressBarAdmin'),
    waitingTimerAdmin: document.getElementById('waitingTimerAdmin'),
    playersAnswersList: document.getElementById('playersAnswersList'),
    liveRanking: document.getElementById('liveRanking'),
    questionCounterAdmin: document.getElementById('questionCounterAdmin'),
    statusTextAdmin: document.getElementById('statusTextAdmin'),
    forceRevealBtn: document.getElementById('forceRevealBtn'),
    endGameBtn: document.getElementById('endGameBtn'),
    answerNoticesAdmin: document.getElementById('answerNoticesAdmin'),
    liveNoticeAdmin: document.getElementById('liveNoticeAdmin'),

    playerCard: document.getElementById('playerGameControls'),
    quizTitlePlayer: document.getElementById('quizTitlePlayer'),
    questionTextPlayer: document.getElementById('questionTextPlayer'),
    progressBarPlayer: document.getElementById('progressBarPlayer'),
    timerPlayer: document.getElementById('timerPlayer'),
    waitingBlockPlayer: document.getElementById('waitingBlockPlayer'),
    waitingProgressBarPlayer: document.getElementById('waitingProgressBarPlayer'),
    waitingTimerPlayer: document.getElementById('waitingTimerPlayer'),
    answersList: document.getElementById('answersList'),
    playerScoreBlock: document.getElementById('playerScoreBlock'),
    playerScore: document.getElementById('playerScore'),
    questionCounterPlayer: document.getElementById('questionCounterPlayer'),
    answerNoticesPlayer: document.getElementById('answerNoticesPlayer'),
    liveNoticePlayer: document.getElementById('liveNoticePlayer'),

    finalResults: document.getElementById('finalResults'),
    finalScoresList: document.getElementById('finalScoresList'),
    backToHomeBtn: document.getElementById('backToHomeBtn'),

    modalRoot: document.getElementById('globalModalRoot')
  };

  // session info
  const currentLobbyCode = sessionStorage.getItem('currentLobbyCode');
  const myPlayerId = localStorage.getItem('myPlayerId');
  const isHost = !!sessionStorage.getItem('activeQuizId');

  if (!currentLobbyCode) {
    console.error('Нет currentLobbyCode в sessionStorage');
    return;
  }

  let sessionState = null;
  let quizData = null;
  let rafId = null;

  let sessionUnsub = null;
  let answersUnsub = null;
  let playersUnsub = null;

  // server time offset ms = serverNow - localNow
  let serverTimeOffset = 0;

  // track last revealed question to avoid duplicate reveals
  let lastRevealedQuestion = null;

  // Helper: toast
  function toast(text) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:10px 14px;border-radius:18px;z-index:10000;opacity:0;transition:opacity .25s';
    document.body.appendChild(el);
    requestAnimationFrame(()=> el.style.opacity = '1');
    setTimeout(()=> { el.style.opacity = '0'; setTimeout(()=> el.remove(), 300); }, 2000);
  }

  // Modal
  function showModal({ title='', message='', confirmText='Ок', cancelText='Отмена', onConfirm=null, onCancel=null, danger=false }) {
    nodes.modalRoot.innerHTML = '';
    nodes.modalRoot.setAttribute('aria-hidden', 'false');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<h3>${title}</h3><p>${message}</p>`;

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = cancelText;
    cancel.onclick = () => {
      nodes.modalRoot.innerHTML = '';
      nodes.modalRoot.setAttribute('aria-hidden', 'true');
      if (onCancel) onCancel();
    };

    const confirm = document.createElement('button');
    confirm.className = danger ? 'btn danger' : 'btn primary';
    confirm.textContent = confirmText;
    confirm.onclick = () => {
      nodes.modalRoot.innerHTML = '';
      nodes.modalRoot.setAttribute('aria-hidden', 'true');
      if (onConfirm) onConfirm();
    };

    actions.appendChild(cancel);
    actions.appendChild(confirm);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    nodes.modalRoot.appendChild(overlay);
  }

  // ---------------------------
  // SERVER CLOCK SYNC
  // ---------------------------
  async function syncServerClock() {
    try {
      const ref = doc(db, 'sys', `serverTime_${currentLobbyCode}`);
      await setDoc(ref, { now: serverTimestamp() }, { merge: true });
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const s = snap.data();
        if (s.now && typeof s.now.toMillis === 'function') {
          const serverMs = s.now.toMillis();
          serverTimeOffset = serverMs - Date.now();
          return serverTimeOffset;
        }
      }
    } catch (e) {
      // likely permission error; fallback to 0 offset
      console.warn('syncServerClock failed (permissions/network):', e);
    }
    serverTimeOffset = 0;
    return 0;
  }
  function getServerNowMs() { return Date.now() + serverTimeOffset; }

  // ---------------------------
  // UI helpers & renderers
  // ---------------------------
  function showAdmin() { nodes.adminCard.style.display = 'block'; nodes.playerCard.style.display = 'none'; }
  function showPlayer(){ nodes.playerCard.style.display = 'block'; nodes.adminCard.style.display = 'none'; }

  function updateHeaderTitles() {
    if (!quizData) return;
    nodes.quizTitleAdmin.textContent = quizData.title || 'Викторина';
    nodes.quizTitlePlayer.textContent = quizData.title || 'Викторина';
  }

  // safe escape
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  // create answer button structure with .fill and .content
  function createAnswerButton(text, index) {
    const btn = document.createElement('button');
    btn.className = 'answer-btn';
    btn.type = 'button';
    btn.dataset.index = String(index);
    btn.innerHTML = `
      <div class="fill" aria-hidden="true"></div>
      <div class="content">
        <div class="label">${escapeHtml(text)}</div>
        <div class="status" aria-hidden="true"></div>
      </div>`;
    return btn;
  }

  function renderAnswersForPlayer(question) {
    nodes.answersList.innerHTML = '';
    if (!question) return;
    question.answers.forEach((text, i) => {
      const btn = createAnswerButton(text, i);
      btn.onclick = async () => {
        // disable immediately
        nodes.answersList.querySelectorAll('.answer-btn').forEach(b => b.disabled = true);
        btn.classList.add('selected');
        try {
          const sSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode));
          if (!sSnap.exists()) return;
          const s = sSnap.data();
          if (s.questionPhase !== 'answering') return;
          const qStart = s.questionStartAt ? s.questionStartAt.toMillis() : null;
          const elapsed = qStart ? Math.floor((getServerNowMs() - qStart)/1000) : Math.floor((Date.now() - (Date.now()-0))/1000);
          const timeTaken = Math.max(0, Math.min(ANSWER_DURATION, elapsed));
          const answerId = `${myPlayerId}_${s.currentQuestion}`;
          await setDoc(doc(db, 'active_sessions', currentLobbyCode, 'answers', answerId), {
            playerId: myPlayerId,
            playerName: (await getPlayerName()) || 'Игрок',
            questionIndex: s.currentQuestion,
            selectedIndex: i,
            timeTaken,
            submittedAt: serverTimestamp()
          });
        } catch (e) {
          console.error('submit answer', e);
        }
      };
      nodes.answersList.appendChild(btn);
    });
  }

  async function getPlayerName() {
    if (!myPlayerId) return null;
    try {
      const pSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode, 'players', myPlayerId));
      return pSnap.exists() ? pSnap.data().name : null;
    } catch (e) { return null; }
  }

  // Admin list of answers
  function renderAdminAnswersList(docs) {
    nodes.playersAnswersList.innerHTML = '';
    docs.forEach(d => {
      const a = d.data();
      if (a.questionIndex !== sessionState.currentQuestion) return;
      const item = document.createElement('div');
      item.className = 'player-answer-tag';
      const status = (typeof a.points === 'number') ? (a.points > 0 ? 'Правильно' : 'Неверно') : (typeof a.selectedIndex === 'number' ? 'Отвечает' : 'Не отвечает');
      const score = (typeof a.points === 'number') ? `+${a.points}` : '-';
      item.innerHTML = `<div style="display:flex;flex-direction:column">
                          <span style="font-weight:900">${escapeHtml(a.playerName || 'Игрок')}</span>
                          <span class="meta">Время: ${a.timeTaken ?? '-'}s</span>
                        </div>
                        <div style="text-align:right">
                          <div class="meta">${status}</div>
                          <div class="score">${score}</div>
                        </div>`;
      nodes.playersAnswersList.appendChild(item);
    });
  }

  // Ranking
  function renderRanking(docs) {
    const arr = [];
    docs.forEach(d => {
      const p = d.data();
      arr.push({ id: d.id, name: p.name || 'Игрок', score: p.score || 0, totalTime: p.totalTime || 0 });
    });
    arr.sort((a,b) => (b.score - a.score) || (a.totalTime - b.totalTime));
    nodes.liveRanking.innerHTML = '';
    arr.forEach((p, idx) => {
      const item = document.createElement('div');
      item.className = 'player-answer-tag';
      item.innerHTML = `<div style="display:flex;flex-direction:column">
                          <span style="font-weight:900">${idx+1}. ${escapeHtml(p.name)}</span>
                          <span class="meta">Время: ${p.totalTime}s</span>
                        </div>
                        <div class="score">${p.score}</div>`;
      nodes.liveRanking.appendChild(item);
    });
    // removed per-player totals update per requirement
  }

  // Reveal UI: ensure fill animation left->right and status icon shown
  async function revealAnswersUI() {
    const qIdx = sessionState.currentQuestion;
    // avoid re-running for same question
    if (lastRevealedQuestion === qIdx) return;
    lastRevealedQuestion = qIdx;

    const q = quizData && quizData.questions ? quizData.questions[qIdx] : null;
    if (!q) return;

    // find all answer buttons
    const buttons = Array.from(nodes.answersList.querySelectorAll('.answer-btn'));
    // reset
    buttons.forEach(b => {
      b.classList.remove('selected', 'correct', 'incorrect');
      b.disabled = true;
      const fill = b.querySelector('.fill');
      if (fill) fill.style.width = '0%';
      const s = b.querySelector('.status');
      if (s) s.textContent = '';
    });

    // Give micro delay to allow CSS reset then apply reveals
    await new Promise(r => setTimeout(r, 40));

    buttons.forEach((b, i) => {
      const s = b.querySelector('.status');
      if (i === q.correctAnswerIndex) {
        b.classList.add('correct');
        if (s) s.textContent = '✓';
      } else {
        b.classList.add('incorrect');
        if (s) s.textContent = '✕';
      }
      // trigger fill expansion
      const fill = b.querySelector('.fill');
      if (fill) {
        // force reflow then expand
        // eslint-disable-next-line no-unused-expressions
        fill.offsetWidth;
        fill.style.width = '100%';
      }
    });

    // show player's points if present
    if (myPlayerId) {
      try {
        const aSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode, 'answers', `${myPlayerId}_${qIdx}`));
        const p = (aSnap.exists() && typeof aSnap.data().points === 'number') ? aSnap.data().points : 0;
        nodes.playerScoreBlock.style.display = 'flex';
        nodes.playerScore.textContent = p;
      } catch (e) { console.warn('reveal player points failed', e); }
    }
  }

  // Final UI
  function showFinalUI(playersDocs) {
    nodes.adminCard.style.display = 'none';
    nodes.playerCard.style.display = 'none';
    nodes.finalResults.style.display = 'block';

    if (!isHost && nodes.backToHomeBtn) nodes.backToHomeBtn.style.display = 'none';
    if (isHost && nodes.backToHomeBtn) nodes.backToHomeBtn.style.display = 'inline-flex';

    const arr = [];
    playersDocs.forEach(d => {
      const p = d.data();
      arr.push({ id: d.id, name: p.name || 'Игрок', score: p.score || 0, totalTime: p.totalTime || 0 });
    });
    arr.sort((a,b) => (b.score - a.score) || (a.totalTime - b.totalTime));
    nodes.finalScoresList.innerHTML = '';

    arr.forEach((p, idx) => {
      const item = document.createElement('div');
      item.className = 'player-answer-tag';
      if (idx === 0) item.classList.add('top-1');
      if (idx === 1) item.classList.add('top-2');
      if (idx === 2) item.classList.add('top-3');

      const trophyHtml = (idx < 3) ? `<div class="trophy" aria-hidden="true">${getTrophySvg(idx+1)}</div>` : '';
      item.innerHTML = `<div style="display:flex;flex-direction:column;align-items:flex-start">
                          <span style="font-weight:900">${idx+1}. ${escapeHtml(p.name)}</span>
                          <span class="meta">Время: ${p.totalTime}s</span>
                        </div>
                        <div style="display:flex;align-items:center">
                          <div class="score">${p.score} баллов</div>
                          ${trophyHtml}
                        </div>`;
      nodes.finalScoresList.appendChild(item);
    });

    // For non-hosts show a leave modal asking to leave (no direct back button)
    if (!isHost) {
      showModal({
        title: 'Итоги оглашены',
        message: 'Игра завершена. Нажмите "Покинуть викторину", чтобы вернуться на главную.',
        confirmText: 'Покинуть викторину',
        cancelText: 'Остаться',
        onConfirm: () => {
          localStorage.removeItem('myPlayerId');
          sessionStorage.clear();
          window.location.href = 'homepage.html';
        }
      });
    }
  }

  function getTrophySvg(place) {
    // Simple centered trophy icon (scalable), colored by place
    if (place === 1) return `<svg width="28" height="28" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g fill="none" fill-rule="evenodd"><path d="M7 3h10v2a4 4 0 0 1-4 4H11A4 4 0 0 1 7 5V3z" fill="#FFD54F"/><path d="M6 7a5 5 0 0 0-4 5v2a4 4 0 0 0 4 4h1v2h6v-2h1a4 4 0 0 0 4-4v-2a5 5 0 0 0-4-5" fill="#D9A800"/></g></svg>`;
    if (place === 2) return `<svg width="28" height="28" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g fill="none" fill-rule="evenodd"><path d="M7 3h10v2a4 4 0 0 1-4 4H11A4 4 0 0 1 7 5V3z" fill="#C7C7C7"/><path d="M6 7a5 5 0 0 0-4 5v2a4 4 0 0 0 4 4h1v2h6v-2h1a4 4 0 0 0 4-4v-2a5 5 0 0 0-4-5" fill="#8F8F8F"/></g></svg>`;
    return `<svg width="28" height="28" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g fill="none" fill-rule="evenodd"><path d="M7 3h10v2a4 4 0 0 1-4 4H11A4 4 0 0 1 7 5V3z" fill="#CD7F32"/><path d="M6 7a5 5 0 0 0-4 5v2a4 4 0 0 0 4 4h1v2h6v-2h1a4 4 0 0 0 4-4v-2a5 5 0 0 0-4-5" fill="#9B5B30"/></g></svg>`;
  }

  // ---------------------------
  // Host scoring logic (kept behavior)
  // ---------------------------
  async function computeAndPersistScores(qIdx) {
    try {
      const answersCol = collection(db, 'active_sessions', currentLobbyCode, 'answers');
      const qRef = query(answersCol, where('questionIndex', '==', qIdx));
      const answersSnap = await getDocs(qRef);
      const correctIdx = quizData.questions[qIdx].correctAnswerIndex;

      const playerAcc = new Map();
      const writePromises = [];

      answersSnap.forEach(aDoc => {
        const a = aDoc.data();
        const pid = a.playerId;
        const timeTaken = typeof a.timeTaken === 'number' ? a.timeTaken : ANSWER_DURATION;
        let points = 0;
        if (typeof a.selectedIndex === 'number' && a.selectedIndex === correctIdx) {
          points = (timeTaken <= (ANSWER_DURATION/2)) ? 2 : 1;
        } else points = 0;

        writePromises.push(updateDoc(doc(db, 'active_sessions', currentLobbyCode, 'answers', aDoc.id), { points }).catch(e => console.warn('answer update failed', e)));

        const prev = playerAcc.get(pid) || { score:0, time:0 };
        prev.score += points;
        prev.time += timeTaken;
        playerAcc.set(pid, prev);
      });

      for (const [pid, acc] of playerAcc.entries()) {
        const pref = doc(db, 'active_sessions', currentLobbyCode, 'players', pid);
        if (increment) {
          writePromises.push(updateDoc(pref, { score: increment(acc.score), totalTime: increment(acc.time) }).catch(e => console.warn('player update failed', e)));
        } else {
          writePromises.push((async () => {
            try {
              const ps = await getDoc(pref);
              const pd = ps.exists() ? ps.data() : {};
              await updateDoc(pref, { score: (pd.score||0)+acc.score, totalTime: (pd.totalTime||0)+acc.time }).catch(()=>{});
            } catch(e){ console.warn('player fallback failed', e); }
          })());
        }
      }

      await Promise.all(writePromises);
      return true;
    } catch (err) {
      console.error('computeAndPersistScores failed', err);
      return false;
    }
  }

  // ---------------------------
  // Host orchestrator (unchanged semantics) but ensures syncServerClock before setting start
  // ---------------------------
  let hostLoopRunning = false;
  async function hostLoopIfNeeded(s) {
    if (!isHost) return;
    if (s.status !== 'playing') return;
    if (hostLoopRunning) return;
    hostLoopRunning = true;

    try {
      const total = quizData.questions.length;
      let idx = (typeof s.currentQuestion === 'number') ? s.currentQuestion : 0;

      while (idx < total) {
        await syncServerClock();
        // set answering with server timestamp
        await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { currentQuestion: idx, questionPhase: 'answering', questionStartAt: serverTimestamp() });

        // Wait ANSWER_DURATION seconds (host local sleep is sufficient because session doc has server timestamp)
        await new Promise(r => setTimeout(r, ANSWER_DURATION * 1000));

        // compute & persist points
        await computeAndPersistScores(idx);

        // set revealing with server timestamp
        await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { questionPhase: 'revealing', revealAt: serverTimestamp() });

        await new Promise(r => setTimeout(r, REVEAL_DURATION * 1000));

        // move to waiting
        await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { questionPhase: 'waiting', waitingStartAt: serverTimestamp() });

        await new Promise(r => setTimeout(r, WAITING_DURATION * 1000));

        idx++;
      }

      await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { status: 'finished' });
    } catch (e) {
      console.error('hostLoop error', e);
    } finally {
      hostLoopRunning = false;
    }
  }

  // ---------------------------
  // Animation loop uses server offset to compute time left (so server/client agree)
  // ---------------------------
  function startAnimLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    function frame() {
      if (sessionState) {
        const phase = sessionState.questionPhase || 'answering';
        const qStart = sessionState.questionStartAt ? sessionState.questionStartAt.toMillis() : null;
        const waitStart = sessionState.waitingStartAt ? sessionState.waitingStartAt.toMillis() : null;

        if (phase === 'answering' && qStart) {
          const elapsed = (getServerNowMs() - qStart) / 1000;
          const left = Math.max(0, ANSWER_DURATION - elapsed);
          const pct = Math.max(0, (left / ANSWER_DURATION) * 100);
          // Set progress WIDTH (shrinking visual)
          nodes.progressBarPlayer.style.width = `${pct}%`;
          nodes.progressBarAdmin.style.width = `${pct}%`;
          nodes.timerPlayer.textContent = String(Math.ceil(left));
          nodes.timerAdmin.textContent = String(Math.ceil(left));
          nodes.waitingBlockPlayer.style.display = 'none';
          nodes.waitingBlockAdmin.style.display = 'none';
        } else if (phase === 'revealing') {
          // Visual timers cleared during reveal
          nodes.progressBarPlayer.style.width = '0%';
          nodes.progressBarAdmin.style.width = '0%';
          nodes.timerPlayer.textContent = '';
          nodes.timerAdmin.textContent = '';
          nodes.waitingBlockPlayer.style.display = 'none';
          nodes.waitingBlockAdmin.style.display = 'none';
        } else if (phase === 'waiting' && waitStart) {
          const elapsed = (getServerNowMs() - waitStart) / 1000;
          const left = Math.max(0, WAITING_DURATION - elapsed);
          const pct = Math.max(0, (left / WAITING_DURATION) * 100);
          nodes.waitingProgressBarPlayer.style.width = `${pct}%`;
          nodes.waitingProgressBarAdmin.style.width = `${pct}%`;
          nodes.waitingTimerPlayer.textContent = String(Math.ceil(left));
          nodes.waitingTimerAdmin.textContent = String(Math.ceil(left));
          nodes.waitingBlockPlayer.style.display = 'block';
          nodes.waitingBlockAdmin.style.display = 'block';
          const textVal = Math.ceil(left);
          const wTextP = document.getElementById('waitingTextPlayer');
          const wTextA = document.getElementById('waitingTextAdmin');
          if (wTextP) wTextP.textContent = textVal;
          if (wTextA) wTextA.textContent = textVal;
        }
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
  }

  // ---------------------------
  // Subscriptions
  // ---------------------------
  function subscribeAnswers() {
    if (answersUnsub) return;
    answersUnsub = onSnapshot(collection(db, 'active_sessions', currentLobbyCode, 'answers'), snapshot => {
      renderAdminAnswersList(snapshot.docs);

      // show compact notices and large live banners for new answers
      snapshot.docChanges().forEach(ch => {
        if (ch.type === 'added' || ch.type === 'modified') {
          const a = ch.doc.data();
          if (!sessionState) return;
          if (a.questionIndex !== sessionState.currentQuestion) return;
          const playerName = a.playerName || 'Игрок';
          // compact chip
          const chip = document.createElement('div');
          chip.className = 'answer-notice';
          chip.textContent = `${playerName} ответил`;
          (a.questionIndex === sessionState.currentQuestion ? nodes.answerNoticesPlayer : nodes.answerNoticesPlayer); // noop, keep semantics
          if (nodes.answerNoticesPlayer) {
            nodes.answerNoticesPlayer.appendChild(chip);
            setTimeout(()=> { chip.style.opacity = '0'; chip.style.transform = 'translateY(-6px)'; setTimeout(()=> chip.remove(), 420); }, 2400);
          }
          if (nodes.answerNoticesAdmin) {
            const chip2 = chip.cloneNode(true);
            nodes.answerNoticesAdmin.appendChild(chip2);
            setTimeout(()=> { chip2.style.opacity = '0'; chip2.style.transform = 'translateY(-6px)'; setTimeout(()=> chip2.remove(), 420); }, 2400);
          }

          // large live banner under header
          showLiveBanner(`${playerName} ответил`, playerName);
        }
      });

      // If phase is revealing ensure reveal UI runs (cover case when answers snapshot arrives before session snapshot)
      if (sessionState && sessionState.questionPhase === 'revealing') {
        revealAnswersUI();
      }
    }, err => console.error('answers onSnapshot error', err));
  }

  // Show a large live banner under the header for a short time
  function showLiveBanner(text, playerName = '') {
    // pick container depending on role
    const container = isHost ? nodes.liveNoticeAdmin : nodes.liveNoticePlayer;
    if (!container) return;
    const banner = document.createElement('div');
    banner.className = 'live-banner';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    // first letter as avatar
    avatar.textContent = playerName ? playerName.trim()[0].toUpperCase() : 'И';

    const t = document.createElement('div');
    t.className = 'text';
    t.textContent = text;

    banner.appendChild(avatar);
    banner.appendChild(t);

    container.appendChild(banner);

    // auto dismiss after 2.6s with exit animation
    setTimeout(() => {
      banner.classList.add('dismiss');
      setTimeout(() => banner.remove(), 360);
    }, 2600);
  }

  function subscribePlayers() {
    if (playersUnsub) return;
    playersUnsub = onSnapshot(collection(db, 'active_sessions', currentLobbyCode, 'players'), snapshot => {
      renderRanking(snapshot.docs);
    }, err => console.error('players onSnapshot error', err));
  }

  // session subscribe is primary sync point: use it to run revealAnswersUI reliably when server sets phase 'revealing'
  function subscribeSession() {
    if (sessionUnsub) return;
    sessionUnsub = onSnapshot(doc(db, 'active_sessions', currentLobbyCode), async snap => {
      if (!snap.exists()) {
        toast('Сессия завершена');
        localStorage.removeItem('myPlayerId');
        sessionStorage.clear();
        setTimeout(()=> window.location.href = 'homepage.html', 700);
        return;
      }

      sessionState = snap.data();

      // re-sync server clock on session updates
      await syncServerClock();

      // load quiz data once (or refresh)
      if (!quizData) {
        try {
          const qSnap = await getDoc(doc(db, 'quizzes', sessionState.quizId));
          if (qSnap.exists()) quizData = qSnap.data();
          updateHeaderTitles();
        } catch (e) { console.warn('quiz fetch failed', e); }
      } else {
        updateHeaderTitles();
      }

      // role UI
      if (isHost) showAdmin(); else showPlayer();

      // update counters
      const total = quizData ? (quizData.questions.length || 0) : 0;
      const cur = (typeof sessionState.currentQuestion === 'number') ? sessionState.currentQuestion : -1;
      nodes.questionCounterAdmin.textContent = `Вопрос ${Math.max(0, cur+1)} / ${total}`;
      nodes.questionCounterPlayer.textContent = `Вопрос ${Math.max(0, cur+1)} / ${total}`;

      // handle finished
      if (sessionState.status === 'finished') {
        const playersSnap = await getDocs(collection(db, 'active_sessions', currentLobbyCode, 'players'));
        showFinalUI(playersSnap.docs);
        return;
      }

      // if currentQuestion changed — render content and answers
      if (typeof sessionState.currentQuestion === 'number') {
        const idx = sessionState.currentQuestion;
        const q = quizData && quizData.questions ? quizData.questions[idx] : null;
        if (q) {
          nodes.questionTextAdmin.textContent = `${idx+1}. ${q.question}`;
          nodes.questionTextPlayer.textContent = `${idx+1}. ${q.question}`;
          renderAnswersForPlayer(q);
          nodes.playerScoreBlock.style.display = 'none';
          // reset lastRevealedQuestion to allow reveal on next phase
          lastRevealedQuestion = null;
        }
      }

      // If server set phase === 'revealing' -> trigger revealAnswersUI now (ensures server-side timing honored)
      if (sessionState.questionPhase === 'revealing') {
        // call reveal UI (clients compute based on server timestamps)
        revealAnswersUI().catch(e => console.warn('revealAnswersUI failed', e));
      }

      // start host loop if needed
      if (isHost && sessionState.status === 'playing') {
        hostLoopIfNeeded(sessionState).catch(console.error);
      }

      // subscribe inner collections
      subscribeAnswers();
      subscribePlayers();

      // start RAF loop
      startAnimLoop();
    }, err => console.error('session onSnapshot', err));
  }

  // Admin controls wiring
  function setupAdminControls() {
    if (!nodes.forceRevealBtn || !nodes.endGameBtn) return;
    nodes.forceRevealBtn.onclick = async () => {
      try {
        if (typeof sessionState.currentQuestion !== 'number') return;
        await computeAndPersistScores(sessionState.currentQuestion);
        await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { questionPhase: 'revealing', revealAt: serverTimestamp() });
      } catch (e) { console.error(e); }
    };

    nodes.endGameBtn.onclick = () => {
      showModal({
        title: 'Завершить игру?',
        message: 'Вы уверены, что хотите завершить викторину сейчас для всех игроков? Действие завершит игру и покажет итоги.',
        confirmText: 'Завершить игру',
        cancelText: 'Отмена',
        danger: true,
        onConfirm: async () => {
          try {
            await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { status: 'finished' });
            setTimeout(()=> { sessionStorage.clear(); window.location.href = 'homepage.html'; }, 700);
          } catch (e) { console.error('end game failed', e); }
        }
      });
    };
  }

  // wire final back button (host)
  if (nodes.backToHomeBtn) nodes.backToHomeBtn.onclick = () => { localStorage.removeItem('myPlayerId'); sessionStorage.clear(); window.location.href = 'homepage.html'; };

  // ---------------------------
  // Kick off
  // ---------------------------
  try {
    await syncServerClock();

    const initSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode));
    if (!initSnap.exists()) {
      toast('Сессия не найдена');
      setTimeout(()=> window.location.href = 'homepage.html', 700);
      return;
    }
    const initData = initSnap.data();
    const qSnap = await getDoc(doc(db, 'quizzes', initData.quizId));
    if (qSnap.exists()) quizData = qSnap.data();
    updateHeaderTitles();

    if (isHost) setupAdminControls();

    subscribeSession();
  } catch (e) {
    console.error('init failure', e);
  }

  // cleanup
  window.addEventListener('beforeunload', () => {
    if (sessionUnsub) sessionUnsub();
    if (answersUnsub) answersUnsub();
    if (playersUnsub) playersUnsub();
    if (rafId) cancelAnimationFrame(rafId);
  });
});