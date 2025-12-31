// js/game_process.js
// Полная версия с учётом всех предыдущих требований.
// Синхронные таймеры через serverTimestamp, host вычисляет очки до reveal,
// revealAnswersUI анимированно красит все варианты слева направо,
// при последнем вопросе текст waiting меняется на "До вывода результатов".
// Требование: js/configure.js должен быть подключён ранее и экспортировать window.fb и window.db,
// а также выставлять window.__FIREBASE_READY__ и диспатчить событие 'firebase-ready' (необязательно, polling работает тоже).

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
    const d = document.createElement('div');
    d.textContent = 'Ошибка: Firebase не инициализирован.';
    d.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#ffecec;color:#900;padding:10px 14px;border-radius:10px;z-index:9999';
    document.body.appendChild(d);
    return;
  }

  const fb = window.fb;
  const db = window.db;

  // get wrapped functions from fb (configure.js must expose these)
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
  let sessionState = null;
  let quizData = null;
  let rafId = null;

  // subscriptions
  let sessionUnsub = null;
  let answersUnsub = null;
  let playersUnsub = null;

  // toast
  function toast(text) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:10px 14px;border-radius:18px;z-index:10000;opacity:0;transition:opacity .25s';
    document.body.appendChild(el);
    requestAnimationFrame(()=> el.style.opacity = '1');
    setTimeout(()=> { el.style.opacity = '0'; setTimeout(()=> el.remove(), 300); }, 2000);
  }

  // UI helpers
  function showAdmin() { nodes.adminCard.style.display = 'block'; nodes.playerCard.style.display = 'none'; }
  function showPlayer(){ nodes.playerCard.style.display = 'block'; nodes.adminCard.style.display = 'none'; }

  function updateHeaderTitles() {
    if (!quizData) return;
    nodes.quizTitleAdmin.textContent = quizData.title || 'Викторина';
    nodes.quizTitlePlayer.textContent = quizData.title || 'Викторина';
  }

  // render answers for player
  function renderAnswersForPlayer(question) {
    nodes.answersList.innerHTML = '';
    if (!question) return;
    question.answers.forEach((text, i) => {
      const btn = document.createElement('button');
      btn.className = 'answer-btn';
      btn.type = 'button';
      btn.innerHTML = `<div>${text}</div><div class="status"></div>`;
      btn.onclick = async () => {
        // disable quick
        nodes.answersList.querySelectorAll('.answer-btn').forEach(b => b.disabled = true);
        btn.classList.add('selected');
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

  // Admin render answers
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
                          <span class="meta">Время: ${a.timeTaken ?? '-'}s</span>
                        </div>
                        <div style="text-align:right">
                          <div class="meta">${status}</div>
                          <div class="score">${score}</div>
                        </div>`;
      nodes.playersAnswersList.appendChild(item);
    });
  }

  // render ranking
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

    if (!isHost && myPlayerId) {
      const me = arr.find(x => x.id === myPlayerId);
      if (me) {
        nodes.yourTotalScore.textContent = `Общий счёт: ${me.score}`;
        nodes.yourTotalTime.textContent = `Общее время: ${me.totalTime} с`;
      }
    }
  }

  // revealAnswersUI: анимированно раскрашивает все варианты слева направо; затем показывает очки игрока
  async function revealAnswersUI() {
    const qIdx = sessionState.currentQuestion;
    const q = quizData && quizData.questions ? quizData.questions[qIdx] : null;
    if (!q) return;

    const buttons = Array.from(nodes.answersList.querySelectorAll('.answer-btn'));

    // сбросить стейт
    buttons.forEach(b => {
      b.classList.remove('selected', 'correct', 'incorrect');
      b.disabled = true;
      const s = b.querySelector('.status'); if (s) s.textContent = '';
    });

    // left-to-right animation
    const delay = 120; // ms between items
    buttons.forEach((b, i) => {
      setTimeout(() => {
        if (i === q.correctAnswerIndex) {
          b.classList.add('correct');
          const s = b.querySelector('.status'); if (s) s.textContent = '✓';
        } else {
          b.classList.add('incorrect');
          const s = b.querySelector('.status'); if (s) s.textContent = '✕';
        }
      }, i * delay);
    });

    // показать очки игроку после полной анимации
    const totalMs = buttons.length * delay + 200;
    setTimeout(async () => {
      if (myPlayerId) {
        try {
          const aSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode, 'answers', `${myPlayerId}_${qIdx}`));
          const p = (aSnap.exists() && typeof aSnap.data().points === 'number') ? aSnap.data().points : 0;
          nodes.playerScoreBlock.style.display = 'flex';
          nodes.playerScore.textContent = p;
        } catch (e) { console.warn(e); }
      }
    }, totalMs);
  }

  // final UI
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

  // computeAndPersistScores (host)
  async function computeAndPersistScores(qIdx) {
    try {
      const answersCol = collection(db, 'active_sessions', currentLobbyCode, 'answers');
      const qRef = query(answersCol, where('questionIndex', '==', qIdx));
      const answersSnap = await getDocs(qRef);
      const correctIdx = quizData.questions[qIdx].correctAnswerIndex;

      const playerAcc = new Map();
      const writes = [];

      answersSnap.forEach(aDoc => {
        const a = aDoc.data();
        const pid = a.playerId;
        const timeTaken = typeof a.timeTaken === 'number' ? a.timeTaken : ANSWER_DURATION;
        let points = 0;
        if (typeof a.selectedIndex === 'number' && a.selectedIndex === correctIdx) {
          points = (timeTaken <= (ANSWER_DURATION/2)) ? 2 : 1;
        } else points = 0;

        writes.push(updateDoc(doc(db, 'active_sessions', currentLobbyCode, 'answers', aDoc.id), { points }).catch(e => console.warn('answer update failed', e)));

        const prev = playerAcc.get(pid) || { score: 0, time: 0 };
        prev.score += points;
        prev.time += timeTaken;
        playerAcc.set(pid, prev);
      });

      for (const [pid, acc] of playerAcc.entries()) {
        const pref = doc(db, 'active_sessions', currentLobbyCode, 'players', pid);
        if (increment) {
          writes.push(updateDoc(pref, { score: increment(acc.score), totalTime: increment(acc.time) }).catch(e => console.warn('player update failed', e)));
        } else {
          writes.push((async () => {
            try {
              const ps = await getDoc(pref);
              const pd = ps.exists() ? ps.data() : {};
              await updateDoc(pref, { score: (pd.score || 0) + acc.score, totalTime: (pd.totalTime || 0) + acc.time }).catch(()=>{});
            } catch(e){ console.warn('player fallback failed', e); }
          })());
        }
      }

      await Promise.all(writes);
      return true;
    } catch (err) {
      console.error('computeAndPersistScores failed', err);
      return false;
    }
  }

  // host loop orchestrator
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
        await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { currentQuestion: idx, questionPhase: 'answering', questionStartAt: serverTimestamp() });

        // wait ANSWER_DURATION
        await new Promise(r => setTimeout(r, ANSWER_DURATION * 1000));

        // compute & persist scores BEFORE reveal
        await computeAndPersistScores(idx);

        // set reveal
        await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { questionPhase: 'revealing', revealAt: serverTimestamp() });

        // allow reveal animation
        await new Promise(r => setTimeout(r, REVEAL_DURATION * 1000));

        // waiting
        await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { questionPhase: 'waiting', waitingStartAt: serverTimestamp() });

        // wait WAITING_DURATION
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

  // smooth RAF loop for timers and waiting text; includes logic to change text for last question
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

          const isLast = quizData && typeof sessionState.currentQuestion === 'number'
                         && sessionState.currentQuestion >= (quizData.questions.length - 1);

          const nextHintPlayer = document.getElementById('nextHintPlayer');
          const nextHintAdmin = document.getElementById('nextHintAdmin');

          if (isLast) {
            if (nextHintPlayer) nextHintPlayer.textContent = `До вывода результатов`;
            if (nextHintAdmin) nextHintAdmin.textContent = `До вывода результатов`;
            // keep numeric badge visible as countdown if desired
            nodes.waitingTimerPlayer.textContent = Math.ceil(left);
            nodes.waitingTimerAdmin.textContent = Math.ceil(left);
          } else {
            if (nextHintPlayer) nextHintPlayer.innerHTML = `Следующий вопрос через <span id="waitingTextPlayer">${textVal}</span> с`;
            if (nextHintAdmin) nextHintAdmin.innerHTML = `Следующий вопрос через <span id="waitingTextAdmin">${textVal}</span> с`;
          }
        }
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
  }

  // subscriptions
  function subscribeAnswers() {
    if (answersUnsub) return;
    answersUnsub = onSnapshot(collection(db, 'active_sessions', currentLobbyCode, 'answers'), snapshot => {
      renderAdminAnswersList(snapshot.docs);
      // if player and currently revealing, trigger reveal UI to read points & animate
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

      if (!quizData) {
        try {
          const qSnap = await getDoc(doc(db, 'quizzes', sessionState.quizId));
          if (qSnap.exists()) quizData = qSnap.data();
          updateHeaderTitles();
        } catch (e) { console.warn('quiz fetch failed', e); }
      }

      if (isHost) showAdmin(); else showPlayer();

      const total = quizData ? (quizData.questions.length || 0) : 0;
      const cur = (typeof sessionState.currentQuestion === 'number') ? sessionState.currentQuestion : -1;
      nodes.questionCounterAdmin.textContent = `Вопрос ${Math.max(0, cur+1)} / ${total}`;
      nodes.questionCounterPlayer.textContent = `Вопрос ${Math.max(0, cur+1)} / ${total}`;

      if (sessionState.status === 'finished') {
        const playersSnap = await getDocs(collection(db, 'active_sessions', currentLobbyCode, 'players'));
        showFinalUI(playersSnap.docs);
        return;
      }

      if (typeof sessionState.currentQuestion === 'number') {
        const idx = sessionState.currentQuestion;
        const q = quizData && quizData.questions ? quizData.questions[idx] : null;
        if (q) {
          nodes.questionTextAdmin.textContent = `${idx+1}. ${q.question}`;
          nodes.questionTextPlayer.textContent = `${idx+1}. ${q.question}`;
          renderAnswersForPlayer(q);
          nodes.playerScoreBlock.style.display = 'none';
        }
      }

      if (isHost && sessionState.status === 'playing') {
        hostLoopIfNeeded(sessionState).catch(console.error);
      }

      subscribeAnswers();
      subscribePlayers();

      startAnimLoop();
    }, err => console.error('session onSnapshot', err));
  }

  // admin controls wiring
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
      if (!confirm('Завершить игру для всех?')) return;
      updateDoc(doc(db, 'active_sessions', currentLobbyCode), { status: 'finished' }).catch(console.error);
    };
  }

  if (nodes.backToHomeBtn) nodes.backToHomeBtn.onclick = () => { localStorage.removeItem('myPlayerId'); sessionStorage.clear(); window.location.href = 'homepage.html'; };

  // init: fetch initial session & quiz, then subscribe
  try {
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