// game_process.js — синхронизованная версия с точным 10s таймером, 5s ожиданием, улучшенной анимацией.
// Требования:
// - configure.js должен выставить window.__FIREBASE_READY__ = true и window.fb/window.db.
// - configure.js должен подключаться до этого скрипта.
// - Используем onSnapshot на документе сессии для мгновенных обновлений фаз/времён.
// - ANSWER_DURATION = 10s, WAITING_DURATION = 5s, REVEAL_DURATION = 1.5s.

const ANSWER_DURATION = 10;    // секунды на ответ
const REVEAL_DURATION = 1.5;   // сек на показ правильных (анимация)
const WAITING_DURATION = 5;    // сек между вопросами (предупреждение)

function waitForFirebaseReady(timeout = 20000) {
    return new Promise((resolve) => {
        if (window.__FIREBASE_READY__) {
            resolve(true);
            return;
        }
        const onReady = (e) => {
            window.removeEventListener('firebase-ready', onReady);
            resolve(true);
        };
        window.addEventListener('firebase-ready', onReady);
        // safety timeout
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
    // provide increment helper if available under fb.increment or fallback to firestore FieldValue
    if (!fb.increment) {
        if (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue && typeof window.firebase.firestore.FieldValue.increment === 'function') {
            fb.increment = window.firebase.firestore.FieldValue.increment;
        }
    }

    const {
        collection, doc, getDoc, setDoc, updateDoc, onSnapshot, deleteDoc, serverTimestamp, getDocs
    } = fb;

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

    // unsubscribe references
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

    // smooth animator for progress using requestAnimationFrame, driven by server timestamps in session doc
    function startSmoothProgressLoop() {
        if (rafId) cancelAnimationFrame(rafId);
        const tick = async () => {
            try {
                const snap = await getDoc(doc(db, 'active_sessions', currentLobbyCode));
                if (!snap.exists()) return;
                const s = snap.data();
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

                    // show main bar and hide waiting bar
                    nodes.waitingBarPlayer.style.display = 'none';
                    nodes.waitingBarAdmin.style.display = 'none';
                } else if (phase === 'revealing') {
                    nodes.timerPlayer.textContent = '';
                    nodes.timerAdmin.textContent = '';
                    // during reveal keep main progress at 0%
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

    // host loop: single running instance
    let hostLoopRunning = false;
    async function hostLoopIfNeeded(sessionData) {
        if (!isHost) return;
        if (sessionData.status !== 'playing') return;
        if (hostLoopRunning) return;
        hostLoopRunning = true;

        try {
            const total = quizData.questions.length;
            // start from server's currentQuestion or 0
            let idx = typeof sessionData.currentQuestion === 'number' ? sessionData.currentQuestion : 0;

            while (idx < total) {
                // set question start (server timestamp)
                await updateDoc(doc(db, 'active_sessions', currentLobbyCode), {
                    currentQuestion: idx,
                    questionPhase: 'answering',
                    questionStartAt: serverTimestamp()
                });

                // wait ANSWER_DURATION (host side)
                await new Promise(r => setTimeout(r, ANSWER_DURATION * 1000));

                // move to reveal
                await updateDoc(doc(db, 'active_sessions', currentLobbyCode), {
                    questionPhase: 'revealing',
                    revealAt: serverTimestamp()
                });

                // short reveal period for animations
                await new Promise(r => setTimeout(r, REVEAL_DURATION * 1000));

                // move to waiting
                await updateDoc(doc(db, 'active_sessions', currentLobbyCode), {
                    questionPhase: 'waiting',
                    waitingStartAt: serverTimestamp()
                });

                // wait WAITING_DURATION with visible "Следующий вопрос через X"
                await new Promise(r => setTimeout(r, WAITING_DURATION * 1000));

                idx++;
            }

            // finished all
            await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { status: 'finished' });
        } catch (e) {
            console.error('host loop error', e);
        } finally {
            hostLoopRunning = false;
        }
    }

    // render answers for player with improved selection visuals
    function renderAnswersForPlayer(question) {
        nodes.answersList.innerHTML = '';
        // create buttons with a left icon placeholder
        question.answers.forEach((t, i) => {
            const btn = document.createElement('button');
            btn.className = 'answer-btn';
            btn.type = 'button';
            btn.setAttribute('role', 'listitem');
            btn.innerHTML = `<div style="flex:1">${t}</div><div class="status-icon" aria-hidden="true"></div>`;
            btn.onclick = async () => {
                // prevent double clicks or if answering phase ended
                try {
                    // read session doc for phase and q index
                    const sessSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode));
                    if (!sessSnap.exists()) return;
                    const s = sessSnap.data();
                    if (s.questionPhase !== 'answering') return;

                    // disable immediately UI
                    nodes.answersList.querySelectorAll('.answer-btn').forEach(b => b.disabled = true);
                    btn.classList.add('selected');

                    const qStart = s.questionStartAt ? s.questionStartAt.toMillis() : Date.now();
                    const elapsed = Math.floor((Date.now() - qStart) / 1000);
                    const timeTaken = Math.max(0, Math.min(ANSWER_DURATION, elapsed));
                    const qIdx = s.currentQuestion;

                    const correctIdx = quizData.questions[qIdx].correctAnswerIndex;
                    const points = (i === correctIdx) ? (timeTaken <= (ANSWER_DURATION / 2) ? 2 : 1) : 0;

                    const answerDocId = `${myPlayerId}_${qIdx}`;
                    await setDoc(doc(db, 'active_sessions', currentLobbyCode, 'answers', answerDocId), {
                        playerId: myPlayerId,
                        playerName: (await getPlayerNameSafe()) || 'Игрок',
                        questionIndex: qIdx,
                        selectedIndex: i,
                        timeTaken,
                        points,
                        submittedAt: serverTimestamp()
                    });

                    // atomic increments if available
                    const playerRef = doc(db, 'active_sessions', currentLobbyCode, 'players', myPlayerId);
                    try {
                        if (fb.increment) {
                            await updateDoc(playerRef, {
                                score: fb.increment(points),
                                totalTime: fb.increment(timeTaken),
                                lastAnsweredAt: serverTimestamp()
                            });
                        } else if (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) {
                            await updateDoc(playerRef, {
                                score: window.firebase.firestore.FieldValue.increment(points),
                                totalTime: window.firebase.firestore.FieldValue.increment(timeTaken),
                                lastAnsweredAt: serverTimestamp()
                            });
                        } else {
                            // fallback read-modify-write
                            const pSnap = await getDoc(playerRef);
                            const pd = pSnap.exists() ? pSnap.data() : {};
                            await updateDoc(playerRef, {
                                score: (pd.score || 0) + points,
                                totalTime: (pd.totalTime || 0) + timeTaken,
                                lastAnsweredAt: serverTimestamp()
                            });
                        }
                    } catch (e) {
                        console.warn('increment failed', e);
                    }

                    // show immediate small feedback
                    nodes.playerScoreBlock.style.display = 'flex';
                    nodes.playerScore.textContent = points;
                    showToast(points > 0 ? `+${points}` : 'Неправильно');
                } catch (err) {
                    console.error('answer submit', err);
                }
            };
            nodes.answersList.appendChild(btn);
        });
    }

    async function getPlayerNameSafe() {
        if (!myPlayerId) return null;
        const pSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode, 'players', myPlayerId));
        return pSnap.exists() ? pSnap.data().name : null;
    }

    // show correct/incorrect with left->right fill animations
    async function revealAnswersUI() {
        const q = quizData.questions[currentQuestionIndex];
        if (!q) return;
        const correctIdx = q.correctAnswerIndex;
        const buttons = Array.from(nodes.answersList.querySelectorAll('.answer-btn'));
        buttons.forEach((b, i) => {
            // clear selected class to make reveal more visible
            b.classList.remove('selected');
            if (i === correctIdx) {
                b.classList.add('correct');
                const icon = b.querySelector('.status-icon');
                if (icon) icon.textContent = '✓';
            } else {
                b.classList.add('incorrect');
                const icon = b.querySelector('.status-icon');
                if (icon) icon.textContent = '✕';
            }
            b.disabled = true;
        });
    }

    // admin: render answers received for current question
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
                                    <div class="meta">${a.points > 0 ? 'Правильно' : 'Неверно'}</div>
                                    <div class="score">+${a.points}</div>
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
            // admin live ranking
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
            // player totals
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
        // subscribe once to players
        if (playersUnsub) playersUnsub();
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

    // listen to session doc changes — central synchronization
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
            // init quizData if not present
            if (!quizData) {
                const quizSnap = await getDoc(doc(db, 'quizzes', s.quizId));
                if (quizSnap.exists()) quizData = quizSnap.data();
            }

            // UI status
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

            // handle question index changes
            if (typeof s.currentQuestion === 'number' && s.currentQuestion !== currentQuestionIndex) {
                currentQuestionIndex = s.currentQuestion;
                const q = quizData.questions[currentQuestionIndex];
                if (!q) return;
                // render question for both roles
                if (isHost) nodes.questionTextAdmin.textContent = `${currentQuestionIndex + 1}. ${q.question}`;
                else {
                    nodes.questionTextPlayer.textContent = `${currentQuestionIndex + 1}. ${q.question}`;
                    nodes.playerScoreBlock.style.display = 'none';
                    renderAnswersForPlayer(q);
                }
            }

            // phases: answering -> revealing -> waiting
            if (s.questionPhase && s.questionPhase !== localPhase) {
                localPhase = s.questionPhase;
                if (localPhase === 'answering') {
                    // show main progress bar and hide waiting
                    nodes.waitingBarPlayer.style.display = 'none';
                    nodes.waitingBarAdmin.style.display = 'none';
                    // ensure answers enabled
                    nodes.answersList.querySelectorAll('.answer-btn').forEach(b => b.disabled = false);
                } else if (localPhase === 'revealing') {
                    // reveal answers visually
                    await revealAnswersUI();
                } else if (localPhase === 'waiting') {
                    // waiting UI handled by smooth loop which shows waitingBar
                }
            }

            // admin responsibilities
            if (isHost) {
                setupAnswersListener();
                setupPlayersListener();
                // attempt to run host loop when status playing
                if (s.status === 'playing') hostLoopIfNeeded(s).catch(console.error);
            } else {
                // player side listeners
                setupPlayersListener();
            }
        });
    }

    // wire admin controls
    function setupAdminControls() {
        nodes.forceRevealBtn.onclick = async () => {
            try {
                await updateDoc(doc(db, 'active_sessions', currentLobbyCode), {
                    questionPhase: 'revealing',
                    revealAt: serverTimestamp()
                });
            } catch (e) { console.error(e); }
        };
        nodes.endGameBtn.onclick = () => {
            if (!confirm('Завершить игру для всех?')) return;
            updateDoc(doc(db, 'active_sessions', currentLobbyCode), { status: 'finished' }).catch(console.error);
        };
    }

    // initialization
    async function init() {
        if (!currentLobbyCode) {
            showToast('Нет активной сессии');
            setTimeout(()=> window.location.href = 'homepage.html', 700);
            return;
        }

        // load session and quiz
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

        // set titles and counts
        nodes.quizTitleAdmin.textContent = quizData.title || 'Викторина';
        nodes.quizTitlePlayer.textContent = quizData.title || 'Викторина';
        const qCount = quizData.questions.length || 0;
        const cur = typeof sessionData.currentQuestion === 'number' ? sessionData.currentQuestion : -1;
        nodes.questionCounterAdmin.textContent = `Вопрос ${Math.max(0, cur+1)} / ${qCount}`;
        nodes.questionCounterPlayer.textContent = `Вопрос ${Math.max(0, cur+1)} / ${qCount}`;

        // role-specific
        if (isHost) setupAdminControls();

        // start loops & listeners
        startSmoothProgressLoop();
        watchSession();
        setupPlayersListener();
    }

    await init();

    // cleanup on unload
    window.addEventListener('beforeunload', () => {
        if (sessionUnsub) sessionUnsub();
        if (answersUnsub) answersUnsub();
        if (playersUnsub) playersUnsub();
        if (rafId) cancelAnimationFrame(rafId);
    });
}

document.addEventListener('DOMContentLoaded', startGameProcess);