// js/game_process.js
// Исправления:
//  - Блок вопроса теперь full-bleed (100% ширины экрана) — handled in CSS/HTML (.full-bleed).
//  - Админ не показывает "Неправильно +0" до вычисления очков — если поле points отсутствует, показываем "Отвечает".
//  - Баллы вычисляются и применяются ХОСТОМ ДО перехода в фазу "revealing" (чтобы клиенты увидели корректные +N).
//  - Игрок при клике лишь сохраняет ответ; отображение очков показывается только при фазе revealing, после того как хост написал points.
//  - Улучшена читаемость/spacing, увеличены шрифты и отступы.

const ANSWER_DURATION = 10;    // seconds to answer
const REVEAL_DURATION = 1.5;   // reveal animation time
const WAITING_DURATION = 5;    // seconds between questions

function waitForFirebaseReady(timeout = 20000) {
    return new Promise((resolve) => {
        if (window.__FIREBASE_READY__) return resolve(true);
        const onReady = () => { window.removeEventListener('firebase-ready', onReady); resolve(!!window.__FIREBASE_READY__); };
        window.addEventListener('firebase-ready', onReady);
        setTimeout(() => { window.removeEventListener('firebase-ready', onReady); resolve(!!window.__FIREBASE_READY__); }, timeout);
    });
}

async function startGameProcess() {
    const ok = await waitForFirebaseReady();
    if (!ok) {
        console.error('Firebase не доступен. Проверьте configure.js и порядок подключений.');
        const d = document.createElement('div'); d.textContent='Ошибка: Firebase не инициализирован.'; d.style.cssText='position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#ffecec;color:#900;padding:10px 14px;border-radius:10px;z-index:9999';
        document.body.appendChild(d);
        return;
    }

    const fb = window.fb;
    const db = window.db;

    // helpers (wrapper may expose these)
    const collection = fb.collection;
    const doc = fb.doc;
    const getDoc = fb.getDoc;
    const setDoc = fb.setDoc;
    const updateDoc = fb.updateDoc;
    const onSnapshot = fb.onSnapshot;
    const getDocs = fb.getDocs;
    const query = fb.query;
    const where = fb.where;
    const serverTimestamp = fb.serverTimestamp;
    const increment = fb.increment || (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue && window.firebase.firestore.FieldValue.increment);

    const nodes = {
        adminGameControls: document.getElementById('adminGameControls'),
        quizTitleAdmin: document.getElementById('quizTitleAdmin'),
        questionTextAdmin: document.getElementById('questionTextAdmin'),
        progressBarAdmin: document.getElementById('progressBarAdmin'),
        timerAdmin: document.getElementById('timerAdmin'),
        waitingBarAdmin: document.getElementById('waitingBarAdmin'),
        waitingProgressBarAdmin: document.getElementById('waitingProgressBarAdmin'),
        waitingTimerAdmin: document.getElementById('waitingTimerAdmin'),
        playersAnswersList: document.getElementById('playersAnswersList'),
        liveRanking: document.getElementById('liveRanking'),
        questionCounterAdmin: document.getElementById('questionCounterAdmin'),
        statusTextAdmin: document.getElementById('statusTextAdmin'),
        forceRevealBtn: document.getElementById('forceRevealBtn'),
        endGameBtn: document.getElementById('endGameBtn'),

        playerGameControls: document.getElementById('playerGameControls'),
        quizTitlePlayer: document.getElementById('quizTitlePlayer'),
        questionTextPlayer: document.getElementById('questionTextPlayer'),
        progressBarPlayer: document.getElementById('progressBarPlayer'),
        timerPlayer: document.getElementById('timerPlayer'),
        waitingBarPlayer: document.getElementById('waitingBarPlayer'),
        waitingProgressBarPlayer: document.getElementById('waitingProgressBarPlayer'),
        waitingTimerPlayer: document.getElementById('waitingTimerPlayer'),
        answersList: document.getElementById('answersList'),
        playerScoreBlock: document.getElementById('playerScoreBlock'),
        playerScore: document.getElementById('playerScore'),
        questionCounterPlayer: document.getElementById('questionCounterPlayer'),
        yourTotalScore: document.getElementById('yourTotalScore'),
        yourTotalTime: document.getElementById('yourTotalTime'),

        finalResults: document.getElementById('finalResults'),
        finalScoresList: document.getElementById('finalScoresList'),
        backToHomeBtn: document.getElementById('backToHomeBtn')
    };

    let currentLobbyCode = sessionStorage.getItem('currentLobbyCode');
    let myPlayerId = localStorage.getItem('myPlayerId');
    let isHost = !!sessionStorage.getItem('activeQuizId');
    let quizData = null;
    let currentQuestionIndex = -1;
    let localPhase = null;
    let rafId = null;

    let sessionUnsub = null;
    let answersUnsub = null;
    let playersUnsub = null;

    function showToast(msg) {
        const t = document.createElement('div'); t.textContent = msg; t.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#262626;color:#fff;padding:10px 16px;border-radius:20px;z-index:9999;opacity:0;transition:opacity .25s'; document.body.appendChild(t);
        requestAnimationFrame(()=> t.style.opacity = '1'); setTimeout(()=> { t.style.opacity = '0'; setTimeout(()=> t.remove(), 300); }, 2200);
    }

    // Smooth progress loop using server timestamps (requestAnimationFrame)
    function startSmoothProgressLoop() {
        if (rafId) cancelAnimationFrame(rafId);
        const tick = async () => {
            try {
                const sSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode));
                if (!sSnap.exists()) return;
                const s = sSnap.data();
                const phase = s.questionPhase || 'answering';
                const qStart = s.questionStartAt ? s.questionStartAt.toMillis() : null;
                const waitStart = s.waitingStartAt ? s.waitingStartAt.toMillis() : null;

                if (phase === 'answering' && qStart) {
                    const elapsed = (Date.now() - qStart) / 1000;
                    const left = Math.max(0, ANSWER_DURATION - elapsed);
                    const pct = Math.max(0, (left / ANSWER_DURATION) * 100);
                    nodes.progressBarPlayer.style.width = `${pct}%`;
                    nodes.progressBarAdmin.style.width = `${pct}%`;
                    nodes.timerPlayer.textContent = Math.ceil(left);
                    nodes.timerAdmin.textContent = Math.ceil(left);
                    nodes.waitingBarPlayer.style.display = 'none';
                    nodes.waitingBarAdmin.style.display = 'none';
                } else if (phase === 'revealing') {
                    nodes.timerPlayer.textContent = '';
                    nodes.timerAdmin.textContent = '';
                    nodes.progressBarPlayer.style.width = `0%`;
                    nodes.progressBarAdmin.style.width = `0%`;
                } else if (phase === 'waiting' && waitStart) {
                    const elapsed = (Date.now() - waitStart) / 1000;
                    const left = Math.max(0, WAITING_DURATION - elapsed);
                    const pct = Math.max(0, (left / WAITING_DURATION) * 100);
                    nodes.waitingProgressBarPlayer.style.width = `${pct}%`;
                    nodes.waitingProgressBarAdmin.style.width = `${pct}%`;
                    nodes.waitingTimerPlayer.textContent = Math.ceil(left);
                    nodes.waitingTimerAdmin.textContent = Math.ceil(left);
                    nodes.waitingBarPlayer.style.display = 'block';
                    nodes.waitingBarAdmin.style.display = 'block';
                }
            } catch (e) {
                console.error('tick error', e);
            } finally {
                rafId = requestAnimationFrame(tick);
            }
        };
        rafId = requestAnimationFrame(tick);
    }

    // HOST: compute and apply scores BEFORE changing phase to 'revealing'
    async function applyScoresAndReveal(qIdx) {
        try {
            // gather answers for qIdx
            const answersCol = collection(db, 'active_sessions', currentLobbyCode, 'answers');
            const qref = query(answersCol, where('questionIndex', '==', qIdx));
            const snap = await getDocs(qref);
            const correctIdx = quizData.questions[qIdx].correctAnswerIndex;

            // Prepare update promises
            const updates = [];
            const playerAggs = new Map(); // pid -> {scoreInc, timeInc}

            snap.forEach(docSnap => {
                const a = docSnap.data();
                const pid = a.playerId;
                const timeTaken = typeof a.timeTaken === 'number' ? a.timeTaken : ANSWER_DURATION;
                let points = 0;
                if (typeof a.selectedIndex === 'number' && a.selectedIndex === correctIdx) {
                    points = timeTaken <= (ANSWER_DURATION / 2) ? 2 : 1;
                } else points = 0;

                // update answer doc with points
                updates.push(updateDoc(doc(db, 'active_sessions', currentLobbyCode, 'answers', docSnap.id), { points }).catch(e => console.warn('answer update failed', e)));

                // accumulate per-player
                const curr = playerAggs.get(pid) || { score: 0, time: 0 };
                curr.score += points;
                curr.time += timeTaken;
                playerAggs.set(pid, curr);
            });

            // update player aggregates (atomic increment if available)
            for (const [pid, agg] of playerAggs.entries()) {
                const pref = doc(db, 'active_sessions', currentLobbyCode, 'players', pid);
                if (increment) {
                    updates.push(updateDoc(pref, { score: increment(agg.score), totalTime: increment(agg.time) }).catch(e => console.warn('player update failed', e)));
                } else {
                    // fallback read-modify-write
                    updates.push((async () => {
                        try {
                            const pSnap = await getDoc(pref);
                            const pd = pSnap.exists() ? pSnap.data() : {};
                            await updateDoc(pref, { score: (pd.score || 0) + agg.score, totalTime: (pd.totalTime || 0) + agg.time }).catch(()=>{});
                        } catch(e) { console.warn('player fallback failed', e); }
                    })());
                }
            }

            await Promise.all(updates);

            // Now set the phase to revealing — clients will read points immediately
            await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { questionPhase: 'revealing', revealAt: serverTimestamp() });
        } catch (err) {
            console.error('applyScoresAndReveal error', err);
            // fallback: still set revealing to avoid deadlock
            try { await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { questionPhase: 'revealing', revealAt: serverTimestamp() }); } catch(e){}
        }
    }

    // HOST loop orchestrator: set start -> wait ANSWER_DURATION -> compute points -> reveal -> wait REVEAL -> waiting -> next
    let hostLoopRunning = false;
    async function hostLoopIfNeeded(sessionData) {
        if (!isHost) return;
        if (sessionData.status !== 'playing') return;
        if (hostLoopRunning) return;
        hostLoopRunning = true;

        try {
            const total = quizData.questions.length;
            let idx = typeof sessionData.currentQuestion === 'number' ? sessionData.currentQuestion : 0;

            while (idx < total) {
                await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { currentQuestion: idx, questionPhase: 'answering', questionStartAt: serverTimestamp() });

                // wait ANSWER_DURATION
                await new Promise(r => setTimeout(r, ANSWER_DURATION * 1000));

                // compute & apply scores first, then set revealing
                await applyScoresAndReveal(idx);

                // keep revealing for REVEAL_DURATION
                await new Promise(r => setTimeout(r, REVEAL_DURATION * 1000));

                // move to waiting
                await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { questionPhase: 'waiting', waitingStartAt: serverTimestamp() });

                // wait WAITING_DURATION
                await new Promise(r => setTimeout(r, WAITING_DURATION * 1000));

                idx++;
            }

            await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { status: 'finished' });
        } catch (err) {
            console.error('hostLoop error', err);
        } finally {
            hostLoopRunning = false;
        }
    }

    // Player submission: write an answer doc WITHOUT points
    async function submitPlayerAnswer(qIdx, selectedIndex) {
        try {
            const sSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode));
            if (!sSnap.exists()) return;
            const s = sSnap.data();
            if (s.questionPhase !== 'answering') return;

            const qStart = s.questionStartAt ? s.questionStartAt.toMillis() : Date.now();
            const elapsed = Math.floor((Date.now() - qStart) / 1000);
            const timeTaken = Math.max(0, Math.min(ANSWER_DURATION, elapsed));

            const answerId = `${myPlayerId}_${qIdx}`;
            await setDoc(doc(db, 'active_sessions', currentLobbyCode, 'answers', answerId), {
                playerId: myPlayerId,
                playerName: (await getPlayerNameSafe()) || 'Игрок',
                questionIndex: qIdx,
                selectedIndex,
                timeTaken,
                submittedAt: serverTimestamp()
                // points will be added by host later
            });
        } catch (e) {
            console.error('submitPlayerAnswer error', e);
        }
    }

    // render answer buttons for player
    function renderAnswersForPlayer(question) {
        nodes.answersList.innerHTML = '';
        question.answers.forEach((text, i) => {
            const btn = document.createElement('button');
            btn.className = 'answer-btn';
            btn.type = 'button';
            btn.innerHTML = `<div style="flex:1">${text}</div><div class="status-icon" aria-hidden="true"></div>`;
            btn.onclick = async () => {
                // quick UI disable and visual selection
                nodes.answersList.querySelectorAll('.answer-btn').forEach(b => b.disabled = true);
                btn.classList.add('selected');
                // only submit player answer; do not set any points here
                await submitPlayerAnswer(currentQuestionIndex, i);
            };
            nodes.answersList.appendChild(btn);
        });
    }

    // reveal answers UI client-side (after host computed points and set phase revealing)
    async function revealAnswersUI() {
        const q = quizData.questions[currentQuestionIndex];
        if (!q) return;
        const correctIdx = q.correctAnswerIndex;
        const buttons = Array.from(nodes.answersList.querySelectorAll('.answer-btn'));

        // color buttons and display points for current player (points written by host)
        buttons.forEach((b, i) => {
            b.classList.remove('selected');
            b.disabled = true;
            if (i === correctIdx) {
                b.classList.add('correct');
                const icon = b.querySelector('.status-icon');
                if (icon) icon.textContent = '✓';
            } else {
                b.classList.add('incorrect');
                const icon = b.querySelector('.status-icon');
                if (icon) icon.textContent = '✕';
            }
        });

        // display player's points from answer doc (host has updated points before revealing)
        if (myPlayerId) {
            try {
                const aId = `${myPlayerId}_${currentQuestionIndex}`;
                const aSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode, 'answers', aId));
                if (aSnap.exists()) {
                    const ad = aSnap.data();
                    const p = (typeof ad.points === 'number') ? ad.points : 0;
                    nodes.playerScoreBlock.style.display = 'flex';
                    nodes.playerScore.textContent = p;
                } else {
                    nodes.playerScoreBlock.style.display = 'flex';
                    nodes.playerScore.textContent = 0;
                }
            } catch (e) {
                console.warn('reveal read answer failed', e);
            }
        }
    }

    // admin answers rendering: handle undefined points as "Отвечает..."
    function setupAnswersListener() {
        if (answersUnsub) return;
        answersUnsub = onSnapshot(collection(db, 'active_sessions', currentLobbyCode, 'answers'), (snap) => {
            nodes.playersAnswersList.innerHTML = '';
            snap.forEach(d => {
                const a = d.data();
                if (a.questionIndex !== currentQuestionIndex) return;
                const tag = document.createElement('div');
                tag.className = 'player-answer-tag';

                // status: if points is undefined => "Отвечает" (или "Ожидание"), else Правильно/Неверно
                let statusText = 'Отвечает';
                let scoreText = '-';
                if (typeof a.points === 'number') {
                    statusText = a.points > 0 ? 'Правильно' : 'Неверно';
                    scoreText = `+${a.points}`;
                } else if (typeof a.selectedIndex === 'number') {
                    statusText = 'Отвечает'; // selected but not yet scored
                    scoreText = '-';
                } else {
                    statusText = 'Не отвечает';
                    scoreText = '-';
                }

                tag.innerHTML = `<div style="display:flex;flex-direction:column">
                                    <span style="font-weight:900">${a.playerName || 'Игрок'}</span>
                                    <span class="meta">Время: ${a.timeTaken ?? '-'}s</span>
                                 </div>
                                 <div style="text-align:right">
                                    <div class="meta">${statusText}</div>
                                    <div class="score">${scoreText}</div>
                                 </div>`;
                nodes.playersAnswersList.appendChild(tag);
            });
        });
    }

    // players ranking listener
    function setupPlayersListener() {
        if (playersUnsub) return;
        playersUnsub = onSnapshot(collection(db, 'active_sessions', currentLobbyCode, 'players'), (snap) => {
            const arr = [];
            snap.forEach(d => {
                const p = d.data();
                arr.push({ id: d.id, name: p.name || 'Игрок', score: p.score || 0, totalTime: p.totalTime || 0 });
            });
            arr.sort((a,b) => (b.score - a.score) || (a.totalTime - b.totalTime));
            if (isHost) {
                nodes.liveRanking.innerHTML = '';
                arr.forEach((p, idx) => {
                    const div = document.createElement('div');
                    div.className = 'player-answer-tag';
                    div.innerHTML = `<div style="display:flex;flex-direction:column">
                                        <span style="font-weight:900">${idx+1}. ${p.name}</span>
                                        <span class="meta">Время: ${p.totalTime}s</span>
                                     </div>
                                     <div class="score">${p.score}</div>`;
                    nodes.liveRanking.appendChild(div);
                });
            }
            if (!isHost && myPlayerId) {
                const me = arr.find(x => x.id === myPlayerId);
                if (me) {
                    nodes.yourTotalScore.textContent = `Общий счёт: ${me.score}`;
                    nodes.yourTotalTime.textContent = `Общее время: ${me.totalTime} с`;
                }
            }
        });
    }

    // final results
    function showFinalResults() {
        nodes.adminGameControls.style.display = 'none';
        nodes.playerGameControls.style.display = 'none';
        nodes.finalResults.style.display = 'block';

        onSnapshot(collection(db, 'active_sessions', currentLobbyCode, 'players'), (snap) => {
            const arr = [];
            snap.forEach(d => {
                const p = d.data();
                arr.push({ name: p.name || 'Игрок', score: p.score || 0, totalTime: p.totalTime || 0 });
            });
            arr.sort((a,b) => (b.score - a.score) || (a.totalTime - b.totalTime));
            nodes.finalScoresList.innerHTML = '';
            arr.forEach((p, idx) => {
                const div = document.createElement('div');
                div.className = 'player-answer-tag';
                div.innerHTML = `<div style="display:flex;flex-direction:column">
                                    <span style="font-weight:900">${idx+1}. ${p.name}</span>
                                    <span class="meta">Время: ${p.totalTime}s</span>
                                 </div>
                                 <div class="score">${p.score} баллов</div>`;
                nodes.finalScoresList.appendChild(div);
            });
        });

        nodes.backToHomeBtn.onclick = () => {
            localStorage.removeItem('myPlayerId');
            sessionStorage.clear();
            window.location.href = 'homepage.html';
        };
    }

    // main session watcher: sync UI & run host loop if necessary
    function watchSession() {
        if (sessionUnsub) return;
        sessionUnsub = onSnapshot(doc(db, 'active_sessions', currentLobbyCode), async (snap) => {
            if (!snap.exists()) {
                showToast('Сессия завершена');
                sessionStorage.clear();
                localStorage.removeItem('myPlayerId');
                setTimeout(()=> window.location.href = 'homepage.html', 900);
                return;
            }
            const s = snap.data();

            // load quiz data once
            if (!quizData) {
                const qSnap = await getDoc(doc(db, 'quizzes', s.quizId));
                if (qSnap.exists()) quizData = qSnap.data();
            }

            if (isHost) {
                nodes.adminGameControls.style.display = 'block';
                nodes.playerGameControls.style.display = 'none';
                nodes.statusTextAdmin.textContent = `Статус: ${s.status || '—'}`;
            } else {
                nodes.playerGameControls.style.display = 'block';
                nodes.adminGameControls.style.display = 'none';
            }

            if (s.status === 'finished') {
                showFinalResults();
                return;
            }

            // question change
            if (typeof s.currentQuestion === 'number' && s.currentQuestion !== currentQuestionIndex) {
                currentQuestionIndex = s.currentQuestion;
                const q = quizData.questions[currentQuestionIndex];
                if (!q) return;
                if (isHost) nodes.questionTextAdmin.textContent = `${currentQuestionIndex + 1}. ${q.question}`;
                else {
                    nodes.questionTextPlayer.textContent = `${currentQuestionIndex + 1}. ${q.question}`;
                    nodes.playerScoreBlock.style.display = 'none';
                    renderAnswersForPlayer(q);
                }
            }

            // handle phase transitions (answering -> revealing -> waiting)
            if (s.questionPhase && s.questionPhase !== localPhase) {
                localPhase = s.questionPhase;
                if (localPhase === 'answering') {
                    // enable answer buttons
                    nodes.answersList.querySelectorAll('.answer-btn').forEach(b => b.disabled = false);
                    nodes.playerScoreBlock.style.display = 'none';
                } else if (localPhase === 'revealing') {
                    // reveal UI will display points (host has already applied points)
                    await revealAnswersUI();
                } else if (localPhase === 'waiting') {
                    // waiting UI handled by RAF loop
                }
            }

            // admin listeners and host control
            if (isHost) {
                setupAnswersListener();
                setupPlayersListener();
                if (s.status === 'playing') hostLoopIfNeeded(s).catch(console.error);
            } else {
                setupPlayersListener();
                // players also need to listen to answers to show "Отвечает" while waiting
                setupAnswersListener(); // safe to call repeatedly (guard inside)
            }
        });
    }

    // admin controls wiring
    function setupAdminControls() {
        nodes.forceRevealBtn.onclick = async () => {
            // If host wants to force reveal: compute scores and reveal immediately
            try {
                const sSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode));
                if (!sSnap.exists()) return;
                const s = sSnap.data();
                if (typeof s.currentQuestion !== 'number') return;
                await applyScoresAndReveal(s.currentQuestion);
            } catch (e) { console.error(e); }
        };
        nodes.endGameBtn.onclick = () => {
            if (!confirm('Завершить игру для всех?')) return;
            updateDoc(doc(db, 'active_sessions', currentLobbyCode), { status: 'finished' }).catch(console.error);
        };
    }

    async function getPlayerNameSafe() {
        if (!myPlayerId) return null;
        try {
            const pSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode, 'players', myPlayerId));
            return pSnap.exists() ? pSnap.data().name : null;
        } catch (e) { return null; }
    }

    // initialization
    async function init() {
        if (!currentLobbyCode) {
            showToast('Нет активной сессии');
            setTimeout(()=> window.location.href = 'homepage.html', 700);
            return;
        }

        const sessionSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode));
        if (!sessionSnap.exists()) {
            showToast('Сессия не существует');
            setTimeout(()=> window.location.href = 'homepage.html', 700);
            return;
        }
        const sessionData = sessionSnap.data();
        const quizSnap = await getDoc(doc(db, 'quizzes', sessionData.quizId));
        if (!quizSnap.exists()) {
            showToast('Викторина не найдена');
            setTimeout(()=> window.location.href = 'homepage.html', 700);
            return;
        }
        quizData = quizSnap.data();

        nodes.quizTitleAdmin.textContent = quizData.title || 'Викторина';
        nodes.quizTitlePlayer.textContent = quizData.title || 'Викторина';
        const qCount = quizData.questions.length || 0;
        const cur = typeof sessionData.currentQuestion === 'number' ? sessionData.currentQuestion : -1;
        nodes.questionCounterAdmin.textContent = `Вопрос ${Math.max(0, cur+1)} / ${qCount}`;
        nodes.questionCounterPlayer.textContent = `Вопрос ${Math.max(0, cur+1)} / ${qCount}`;

        if (isHost) setupAdminControls();

        startSmoothProgressLoop();
        watchSession();
    }

    await init();

    window.addEventListener('beforeunload', () => {
        if (sessionUnsub) sessionUnsub();
        if (answersUnsub) answersUnsub();
        if (playersUnsub) playersUnsub();
        if (rafId) cancelAnimationFrame(rafId);
    });
}

document.addEventListener('DOMContentLoaded', startGameProcess);