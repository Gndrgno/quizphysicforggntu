// game_process.js — обновлённый: баллы начисляются только хостом при переходе в фазу revealing.
// Требования: configure.js должен быть подключён раньше и выставлять window.fb и window.db и событие 'firebase-ready'.

const ANSWER_DURATION = 10;    // секунды на ответ
const REVEAL_DURATION = 1.5;   // сек во время показа реакции (анимация)
const WAITING_DURATION = 5;    // сек между вопросами (предупреждение)

function waitForFirebaseReady(timeout = 20000) {
    return new Promise((resolve) => {
        if (window.__FIREBASE_READY__) {
            resolve(true);
            return;
        }
        const onReady = (e) => {
            window.removeEventListener('firebase-ready', onReady);
            resolve(!!window.__FIREBASE_READY__);
        };
        window.addEventListener('firebase-ready', onReady);
        setTimeout(() => {
            window.removeEventListener('firebase-ready', onReady);
            resolve(!!window.__FIREBASE_READY__);
        }, timeout);
    });
}

async function startGameProcess() {
    const ok = await waitForFirebaseReady();
    if (!ok) {
        console.error('Firebase не доступен. Проверьте configure.js и порядок подключений.');
        const d = document.createElement('div');
        d.textContent = 'Ошибка: Firebase не инициализирован.';
        d.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#ffecec;color:#900;padding:10px 14px;border-radius:10px;z-index:9999';
        document.body.appendChild(d);
        return;
    }

    const fb = window.fb;
    const db = window.db;

    // helpers
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
        const t = document.createElement('div');
        t.textContent = msg;
        t.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#262626;color:#fff;padding:10px 16px;border-radius:20px;z-index:9999;opacity:0;transition:opacity .25s';
        document.body.appendChild(t);
        requestAnimationFrame(()=> t.style.opacity = '1');
        setTimeout(()=> { t.style.opacity = '0'; setTimeout(()=> t.remove(), 300); }, 2200);
    }

    // Smooth progress loop using server timestamps
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

    // Host calculates scores only when moving to reveal phase.
    async function applyScoresForQuestion(qIdx) {
        try {
            // check if already applied
            const sessRef = doc(db, 'active_sessions', currentLobbyCode);
            const sSnap = await getDoc(sessRef);
            if (!sSnap.exists()) return;
            const sData = sSnap.data();
            if (sData.lastScoredQuestion === qIdx) return; // already applied

            // load answers for this question
            const answersQ = await getDocs(query(collection(db, 'active_sessions', currentLobbyCode, 'answers'), where('questionIndex', '==', qIdx)));
            const correctIdx = quizData.questions[qIdx].correctAnswerIndex;

            // Build updates
            const updates = [];
            answersQ.forEach(aDoc => {
                const a = aDoc.data();
                const pid = a.playerId;
                const timeTaken = typeof a.timeTaken === 'number' ? a.timeTaken : (a.timeTaken ? a.timeTaken : ANSWER_DURATION);
                let points = 0;
                if (typeof a.selectedIndex === 'number' && a.selectedIndex === correctIdx) {
                    points = timeTaken <= (ANSWER_DURATION / 2) ? 2 : 1;
                } else points = 0;

                // update answer doc with points (so clients can show it)
                updates.push((async () => {
                    try {
                        await updateDoc(doc(db, 'active_sessions', currentLobbyCode, 'answers', aDoc.id), { points });
                    } catch(e){ console.warn('fail update answer points', e); }
                })());

                // update player aggregate
                updates.push((async () => {
                    try {
                        const playerRef = doc(db, 'active_sessions', currentLobbyCode, 'players', pid);
                        if (increment) {
                            await updateDoc(playerRef, {
                                score: increment(points),
                                totalTime: increment(timeTaken)
                            });
                        } else {
                            // fallback read-modify-write
                            const pSnap = await getDoc(playerRef);
                            const pd = pSnap.exists() ? pSnap.data() : {};
                            await updateDoc(playerRef, {
                                score: (pd.score || 0) + points,
                                totalTime: (pd.totalTime || 0) + timeTaken
                            });
                        }
                    } catch(e){ console.warn('fail update player aggregate', e); }
                })());
            });

            await Promise.all(updates);

            // mark as processed
            try {
                await updateDoc(sessRef, { lastScoredQuestion: qIdx });
            } catch(e){ /* non-critical */ }
        } catch (err) {
            console.error('applyScoresForQuestion error', err);
        }
    }

    // host loop
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
                // start question
                await updateDoc(doc(db, 'active_sessions', currentLobbyCode), {
                    currentQuestion: idx,
                    questionPhase: 'answering',
                    questionStartAt: serverTimestamp()
                });

                // wait ANSWER_DURATION
                await new Promise(r => setTimeout(r, ANSWER_DURATION * 1000));

                // move to reveal (points must be applied only now)
                await updateDoc(doc(db, 'active_sessions', currentLobbyCode), {
                    questionPhase: 'revealing',
                    revealAt: serverTimestamp()
                });

                // apply scoring for this question
                await applyScoresForQuestion(idx);

                // allow reveal animation
                await new Promise(r => setTimeout(r, REVEAL_DURATION * 1000));

                // waiting phase
                await updateDoc(doc(db, 'active_sessions', currentLobbyCode), {
                    questionPhase: 'waiting',
                    waitingStartAt: serverTimestamp()
                });

                // wait WAITING_DURATION (e.g., 5s)
                await new Promise(r => setTimeout(r, WAITING_DURATION * 1000));

                idx++;
            }

            // finished
            await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { status: 'finished' });
        } catch (err) {
            console.error('host loop error', err);
        } finally {
            hostLoopRunning = false;
        }
    }

    // Player submits answer: create answer doc WITHOUT awarding points
    async function submitPlayerAnswer(qIdx, selectedIndex) {
        try {
            const sSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode));
            if (!sSnap.exists()) return;
            const s = sSnap.data();
            if (s.questionPhase !== 'answering') return; // only allow during answering

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
                // NOTE: no 'points' yet — host will add it during revealing
            });
        } catch (e) {
            console.error('submitPlayerAnswer error', e);
        }
    }

    // render answers for players (visual submit handler writes answer doc only)
    function renderAnswersForPlayer(question) {
        nodes.answersList.innerHTML = '';
        question.answers.forEach((t, idx) => {
            const btn = document.createElement('button');
            btn.className = 'answer-btn';
            btn.type = 'button';
            btn.innerHTML = `<div style="flex:1">${t}</div><div class="status-icon" aria-hidden="true"></div>`;
            btn.onclick = async () => {
                // disable buttons quickly
                nodes.answersList.querySelectorAll('.answer-btn').forEach(b => b.disabled = true);
                // visually mark selected
                btn.classList.add('selected');
                // submit (no scoring now)
                await submitPlayerAnswer(currentQuestionIndex, idx);
                // keep showing selected until reveal
            };
            nodes.answersList.appendChild(btn);
        });
    }

    // reveal answers UI: color buttons
    async function revealAnswersUI() {
        const q = quizData.questions[currentQuestionIndex];
        if (!q) return;
        const correctIdx = q.correctAnswerIndex;
        const buttons = Array.from(nodes.answersList.querySelectorAll('.answer-btn'));
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

        // show player's points in pill by reading answer doc (host should already write points)
        if (myPlayerId) {
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
        }
    }

    // listeners for admin answers for current question
    function setupAnswersListener() {
        if (answersUnsub) return;
        answersUnsub = onSnapshot(collection(db, 'active_sessions', currentLobbyCode, 'answers'), (snap) => {
            nodes.playersAnswersList.innerHTML = '';
            snap.forEach(d => {
                const a = d.data();
                if (a.questionIndex !== currentQuestionIndex) return;
                const tag = document.createElement('div');
                tag.className = 'player-answer-tag';
                tag.innerHTML = `<div style="display:flex;flex-direction:column">
                                    <span style="font-weight:900">${a.playerName || 'Игрок'}</span>
                                    <span class="meta">Время: ${a.timeTaken}s</span>
                                 </div>
                                 <div style="text-align:right">
                                    <div class="meta">${(a.points && a.points > 0) ? 'Правильно' : 'Неверно'}</div>
                                    <div class="score">+${a.points ? a.points : 0}</div>
                                 </div>`;
                nodes.playersAnswersList.appendChild(tag);
            });
        });
    }

    // players ranking
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

    // final screen
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

    // watch session
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

            // finished
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

            // phase transitions
            if (s.questionPhase && s.questionPhase !== localPhase) {
                localPhase = s.questionPhase;
                if (localPhase === 'answering') {
                    // enable answers
                    nodes.answersList.querySelectorAll('.answer-btn').forEach(b => b.disabled = false);
                    nodes.playerScoreBlock.style.display = 'none';
                } else if (localPhase === 'revealing') {
                    // reveal UI and ensure answers are marked
                    await revealAnswersUI();
                } else if (localPhase === 'waiting') {
                    // waiting UI handled by smooth loop
                }
            }

            // host duties
            if (isHost) {
                setupAnswersListener();
                setupPlayersListener();
                if (s.status === 'playing') hostLoopIfNeeded(s).catch(console.error);
            } else {
                // players listen for totals
                setupPlayersListener();
            }
        });
    }

    // admin controls
    function setupAdminControls() {
        nodes.forceRevealBtn.onclick = async () => {
            try {
                await updateDoc(doc(db, 'active_sessions', currentLobbyCode), {
                    questionPhase: 'revealing',
                    revealAt: serverTimestamp()
                });
                // host will still compute scores automatically in hostLoopIfNeeded
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

    // init
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