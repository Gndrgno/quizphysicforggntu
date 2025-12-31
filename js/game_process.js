// js/game_process.js
// Полностью переработанная версия: синхронные таймеры на основе server timestamps,
// host вычисляет и пишет очки перед фазой 'revealing' (чтобы клиенты видели корректные значения),
// full-bleed UI интеграция, плавные анимации.
// Требование: js/configure.js должен быть подключён до этого скрипта и выставлять window.fb и window.db и событие 'firebase-ready'.

const ANSWER_DURATION = 10;    // seconds
const REVEAL_DURATION = 1.5;   // seconds (animation)
const WAITING_DURATION = 5;    // seconds between questions

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

  // Preferred API access via fb wrapper (configure.js must expose these)
  const { collection, doc, getDoc, setDoc, updateDoc, onSnapshot, getDocs, query, where, serverTimestamp } = fb;
  const increment = fb.increment || (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue && window.firebase.firestore.FieldValue.increment);

  // DOM nodes
  const nodes = {
    // admin
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

    // player
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
    yourTotalScore: document.getElementById('yourTotalScore'),
    yourTotalTime: document.getElementById('yourTotalTime'),

    // final
    finalResults: document.getElementById('finalResults'),
    finalScoresList: document.getElementById('finalScoresList'),
    backToHomeBtn: document.getElementById('backToHomeBtn')
  };

  // session & user info
  const currentLobbyCode = sessionStorage.getItem('currentLobbyCode');
  const myPlayerId = localStorage.getItem('myPlayerId');
  const isHost = !!sessionStorage.getItem('activeQuizId');

  if (!currentLobbyCode) {
    console.error('Нет currentLobbyCode в sessionStorage');
    return;
  }

  // local reactive session state (updated from onSnapshot)
  let sessionState = null; // raw snapshot data
  let quizData = null;
  let rafId = null;

  // subscriptions
  let sessionUnsub = null;
  let answersUnsub = null;
  let playersUnsub = null;

  // helper: toast
  function toast(text) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:10px 14px;border-radius:18px;z-index:10000;opacity:0;transition:opacity .25s';
    document.body.appendChild(el);
    requestAnimationFrame(()=> el.style.opacity = '1');
    setTimeout(()=> { el.style.opacity = '0'; setTimeout(()=> el.remove(), 300); }, 2000);
  }

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

  function renderAnswersForPlayer(question) {
    nodes.answersList.innerHTML = '';
    if (!question) return;
    question.answers.forEach((text, i) => {
      const btn = document.createElement('button');
      btn.className = 'answer-btn';
      btn.type = 'button';
      btn.innerHTML = `<div>${text}</div><div class="status"></div>`;
      btn.onclick = async () => {
        // disable immediate
        nodes.answersList.querySelectorAll('.answer-btn').forEach(b => b.disabled = true);
        btn.classList.add('selected');
        // write answer doc (no points)
        try {
          const sSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode));
          if (!sSnap.exists()) return;
          const s = sSnap.data();
          if (s.questionPhase !== 'answering') return;
          const qStart = s.questionStartAt ? s.questionStartAt.toMillis() : Date.now();
          const elapsed = Math.floor((Date.now() - qStart)/1000);
          const timeTaken = Math.max(0, Math.min(ANSWER_DURATION, elapsed));
          const answerId = `${myPlayerId}_${s.currentQuestion}`;
          await setDoc(doc(db, 'active_sessions', currentLobbyCode, 'answers', answerId), {
            playerId: myPlayerId,
            playerName: (await getPlayerName()) || 'Игрок',
            questionIndex: s.currentQuestion,
            selectedIndex: i,
            timeTaken,
            submittedAt: serverTimestamp()
            // points field left for host
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
    } catch { return null; }
  }

  // Admin: render answers list (shows "Отвечает" until points exist)
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
                          <span style="font-weight:900">${a.playerName || 'Игрок'}</span>
                          <span class="meta">Время: ${a.timeTaken ?? '-' }s</span>
                        </div>
                        <div style="text-align:right">
                          <div class="meta">${status}</div>
                          <div class="score">${score}</div>
                        </div>`;
      nodes.playersAnswersList.appendChild(item);
    });
  }

  // Admin & Player: render ranking
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
                          <span style="font-weight:900">${idx+1}. ${p.name}</span>
                          <span class="meta">Время: ${p.totalTime}s</span>
                        </div>
                        <div class="score">${p.score}</div>`;
      nodes.liveRanking.appendChild(item);
    });

    // player totals update
    if (!isHost && myPlayerId) {
      const me = arr.find(x => x.id === myPlayerId);
      if (me) {
        nodes.yourTotalScore.textContent = `Общий счёт: ${me.score}`;
        nodes.yourTotalTime.textContent = `Общее время: ${me.totalTime} с`;
      }
    }
  }

  // Reveal UI for players: colors buttons and show player's points (host already wrote points)
  async function revealAnswersUI() {
    const qIdx = sessionState.currentQuestion;
    const q = quizData.questions[qIdx];
    if (!q) return;
    const buttons = Array.from(nodes.answersList.querySelectorAll('.answer-btn'));
    buttons.forEach((b, i) => {
      b.classList.remove('selected');
      b.disabled = true;
      if (i === q.correctAnswerIndex) {
        b.classList.add('correct');
        const s = b.querySelector('.status');
        if (s) s.textContent = '✓';
      } else {
        b.classList.add('incorrect');
        const s = b.querySelector('.status');
        if (s) s.textContent = '✕';
      }
    });

    // Show player's points (from answer doc)
    if (myPlayerId) {
      try {
        const aSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode, 'answers', `${myPlayerId}_${qIdx}`));
        const p = (aSnap.exists() && typeof aSnap.data().points === 'number') ? aSnap.data().points : 0;
        nodes.playerScoreBlock.style.display = 'flex';
        nodes.playerScore.textContent = p;
      } catch (e) { console.warn(e); }
    }
  }

  // Final results UI
  function showFinalUI(playersDocs) {
    nodes.adminCard.style.display = 'none';
    nodes.playerCard.style.display = 'none';
    nodes.finalResults.style.display = 'block';
    const arr = [];
    playersDocs.forEach(d => {
      const p = d.data();
      arr.push({ name: p.name || 'Игрок', score: p.score || 0, totalTime: p.totalTime || 0 });
    });
    arr.sort((a,b) => (b.score - a.score) || (a.totalTime - b.totalTime));
    nodes.finalScoresList.innerHTML = '';
    arr.forEach((p, idx) => {
      const item = document.createElement('div');
      item.className = 'player-answer-tag';
      item.innerHTML = `<div style="display:flex;flex-direction:column">
                          <span style="font-weight:900">${idx+1}. ${p.name}</span>
                          <span class="meta">Время: ${p.totalTime}s</span>
                        </div>
                        <div class="score">${p.score} баллов</div>`;
      nodes.finalScoresList.appendChild(item);
    });
  }

  // ---------------------------
  // Host scoring: gather answers, compute points, update docs and player aggregates
  // ---------------------------
  async function computeAndPersistScores(qIdx) {
    try {
      const answersCol = collection(db, 'active_sessions', currentLobbyCode, 'answers');
      const qRef = query(answersCol, where('questionIndex', '==', qIdx));
      const answersSnap = await getDocs(qRef);
      const correctIdx = quizData.questions[qIdx].correctAnswerIndex;

      // accumulate per-player increments
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

        // update answer doc with calculated points
        writePromises.push(updateDoc(doc(db, 'active_sessions', currentLobbyCode, 'answers', aDoc.id), { points }).catch(e => console.warn('answer update failed', e)));

        const prev = playerAcc.get(pid) || { score:0, time:0 };
        prev.score += points;
        prev.time += timeTaken;
        playerAcc.set(pid, prev);
      });

      // update player aggregates
      for (const [pid, acc] of playerAcc.entries()) {
        const pref = doc(db, 'active_sessions', currentLobbyCode, 'players', pid);
        if (increment) {
          writePromises.push(updateDoc(pref, { score: increment(acc.score), totalTime: increment(acc.time) }).catch(e => console.warn('player update failed', e)));
        } else {
          // fallback
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
  // Host loop: orchestrates questionStartAt -> wait ANSWER_DURATION -> compute scores -> set revealing -> wait REVEAL_DURATION -> set waiting -> wait WAITING_DURATION -> next
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
        // Set start
        await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { currentQuestion: idx, questionPhase: 'answering', questionStartAt: serverTimestamp() });

        // Wait ANSWER_DURATION seconds
        await new Promise(r => setTimeout(r, ANSWER_DURATION * 1000));

        // Compute and persist scores BEFORE revealing so that clients see points on reveal
        await computeAndPersistScores(idx);

        // Now set revealing phase (clients will read points now)
        await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { questionPhase: 'revealing', revealAt: serverTimestamp() });

        // keep revealing for REVEAL_DURATION
        await new Promise(r => setTimeout(r, REVEAL_DURATION * 1000));

        // move to waiting
        await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { questionPhase: 'waiting', waitingStartAt: serverTimestamp() });

        // wait WAITING_DURATION
        await new Promise(r => setTimeout(r, WAITING_DURATION * 1000));

        idx++;
      }

      // finished
      await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { status: 'finished' });
    } catch (e) {
      console.error('hostLoop error', e);
    } finally {
      hostLoopRunning = false;
    }
  }

  // ---------------------------
  // Smooth timer loop using latest sessionState (no network on every frame)
  // ---------------------------
  function startAnimLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    function frame() {
      if (sessionState) {
        const phase = sessionState.questionPhase || 'answering';
        const qStart = sessionState.questionStartAt ? sessionState.questionStartAt.toMillis() : null;
        const waitStart = sessionState.waitingStartAt ? sessionState.waitingStartAt.toMillis() : null;

        if (phase === 'answering' && qStart) {
          const elapsed = (Date.now() - qStart) / 1000;
          const left = Math.max(0, ANSWER_DURATION - elapsed);
          const pct = Math.max(0, (left / ANSWER_DURATION) * 100);
          nodes.progressBarPlayer.style.width = `${pct}%`;
          nodes.progressBarAdmin.style.width = `${pct}%`;
          nodes.timerPlayer.textContent = Math.ceil(left);
          nodes.timerAdmin.textContent = Math.ceil(left);
          nodes.waitingBlockPlayer.style.display = 'none';
          nodes.waitingBlockAdmin.style.display = 'none';
        } else if (phase === 'revealing') {
          nodes.progressBarPlayer.style.width = '0%';
          nodes.progressBarAdmin.style.width = '0%';
          nodes.timerPlayer.textContent = '';
          nodes.timerAdmin.textContent = '';
        } else if (phase === 'waiting' && waitStart) {
          const elapsed = (Date.now() - waitStart) / 1000;
          const left = Math.max(0, WAITING_DURATION - elapsed);
          const pct = Math.max(0, (left / WAITING_DURATION) * 100);
          nodes.waitingProgressBarPlayer.style.width = `${pct}%`;
          nodes.waitingProgressBarAdmin.style.width = `${pct}%`;
          nodes.waitingTimerPlayer.textContent = Math.ceil(left);
          nodes.waitingTimerAdmin.textContent = Math.ceil(left);
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
  // Subscriptions: session, answers, players
  // ---------------------------
  // answers subscription used by admin and players (to show "Отвечает" and to display points after reveal)
  function subscribeAnswers() {
    if (answersUnsub) return;
    answersUnsub = onSnapshot(collection(db, 'active_sessions', currentLobbyCode, 'answers'), snapshot => {
      // render admin answers
      renderAdminAnswersList(snapshot.docs);
      // if client is player and phase is revealing, update player's displayed points
      if (!isHost && sessionState && sessionState.questionPhase === 'revealing') {
        revealAnswersUI();
      }
    }, err => console.error('answers onSnapshot error', err));
  }

  function subscribePlayers() {
    if (playersUnsub) return;
    playersUnsub = onSnapshot(collection(db, 'active_sessions', currentLobbyCode, 'players'), snapshot => {
      renderRanking(snapshot.docs);
    }, err => console.error('players onSnapshot error', err));
  }

  // session subscribe: main synchronization source for timers & phases
  function subscribeSession() {
    if (sessionUnsub) return;
    sessionUnsub = onSnapshot(doc(db, 'active_sessions', currentLobbyCode), async snap => {
      if (!snap.exists()) {
        toast('Сессия завершена');
        // cleanup and redirect
        localStorage.removeItem('myPlayerId');
        sessionStorage.clear();
        setTimeout(()=> window.location.href = 'homepage.html', 700);
        return;
      }
      sessionState = snap.data();

      // load quiz data once if needed
      if (!quizData) {
        try {
          const qSnap = await getDoc(doc(db, 'quizzes', sessionState.quizId));
          if (qSnap.exists()) quizData = qSnap.data();
          updateHeaderTitles();
        } catch (e) { console.warn('quiz fetch failed', e); }
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
        // fetch players one-time for final
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
          // render answers for player (safe even for admin)
          renderAnswersForPlayer(q);
          // reset player's score pill
          nodes.playerScoreBlock.style.display = 'none';
        }
      }

      // start host's orchestration if needed
      if (isHost && sessionState.status === 'playing') {
        hostLoopIfNeeded(sessionState).catch(console.error);
      }

      // subscribe answers & players if not yet
      subscribeAnswers();
      subscribePlayers();

      // start RAF loop to animate timers
      startAnimLoop();
    }, err => console.error('session onSnapshot', err));
  }

  // Admin controls
  function setupAdminControls() {
    if (!nodes.forceRevealBtn || !nodes.endGameBtn) return;
    nodes.forceRevealBtn.onclick = async () => {
      try {
        if (typeof sessionState.currentQuestion !== 'number') return;
        // compute scores and reveal immediately
        await computeAndPersistScores(sessionState.currentQuestion);
        await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { questionPhase: 'revealing', revealAt: serverTimestamp() });
      } catch (e) { console.error(e); }
    };
    nodes.endGameBtn.onclick = () => {
      if (!confirm('Завершить игру для всех?')) return;
      updateDoc(doc(db, 'active_sessions', currentLobbyCode), { status: 'finished' }).catch(console.error);
    };
  }

  // wire final back button
  if (nodes.backToHomeBtn) nodes.backToHomeBtn.onclick = () => { localStorage.removeItem('myPlayerId'); sessionStorage.clear(); window.location.href = 'homepage.html'; };

  // kick off
  // pre-load some things, then subscribe
  try {
    // fetch initial session to confirm exists and obtain quizId
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

    subscribeSession(); // will start everything and subscribe inner collections
  } catch (e) {
    console.error('init failure', e);
  }

  // cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (sessionUnsub) sessionUnsub();
    if (answersUnsub) answersUnsub();
    if (playersUnsub) playersUnsub();
    if (rafId) cancelAnimationFrame(rafId);
  });
});