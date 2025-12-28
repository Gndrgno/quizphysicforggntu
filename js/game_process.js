// Game process logic (module) — исправлённый вариант с более надёжным ожиданием Firebase
// Основная проблема — бесконечные быстрые вызовы startGameProcess из-за того, что
// getFirebaseConfig возвращал null и старт повторялся через setTimeout без ограничения.
// Теперь используется waitForFirebase с таймаутом и более надёжным детектом глобальных экспортов.

const ANSWER_DURATION = 10;   // seconds players can answer
const REVEAL_DURATION = 2;    // seconds to show reveal animation
const WAITING_DURATION = 20;  // seconds between questions

// Попытки обнаружить firebase/db в разных глобальных вариантах
function detectFirebase() {
    // Common custom wrapper: window.fb + window.db
    if (window.fb && (window.db || window.fb.db)) {
        return { fb: window.fb, db: window.db || window.fb.db };
    }

    // Classic Firebase (names may vary):
    // Compat SDK usually exposes firebase.firestore as function
    if (window.firebase) {
        try {
            // If compat SDK loaded: firebase.firestore is a function returning Firestore instance
            if (typeof window.firebase.firestore === 'function') {
                const fb = window.firebase;
                const db = window.firebase.firestore();
                return { fb, db };
            }

            // If modular SDK was exposed on window (less common), attempt common shapes
            // e.g. window.firebaseApp + window.getFirestore (this is heuristic)
            if (window.firebaseApp && typeof window.getFirestore === 'function') {
                const fb = {
                    // we can't reconstruct full modular API here; provide minimal pieces
                    increment: window.firebase && window.firebase.firestore ? window.firebase.firestore.FieldValue.increment : undefined
                };
                const db = window.getFirestore(window.firebaseApp);
                return { fb, db };
            }
        } catch (e) {
            // ignore and continue
        }
    }

    // If none found, return null
    return null;
}

// Wait for firebase to become available, with a timeout and polite backoff.
// Это предотвращает спам в консоли и бесконечные короткие таймауты.
async function waitForFirebase({ timeout = 20000, interval = 600 } = {}) {
    const start = Date.now();
    let firstLog = true;
    while (Date.now() - start < timeout) {
        const cfg = detectFirebase();
        if (cfg) return cfg;

        // Log the waiting message only occasionally to avoid console spam
        if (firstLog) {
            console.warn("Firebase ожидание...");
            firstLog = false;
        }
        await new Promise(res => setTimeout(res, interval));
    }
    return null;
}

const startGameProcess = async () => {
    // Ждём firebase (однократно) с таймаутом
    const config = await waitForFirebase();
    if (!config) {
        console.error("Firebase не обнаружен в глобальной области в течение отведённого времени. Проверьте, загружены ли скрипты Firebase инициализация до game_process.js.");
        // Показываем пользователю уведомление на странице (если есть доступ к DOM)
        try {
            const notice = document.createElement('div');
            notice.textContent = 'Ошибка: Firebase не инициализирован. Обратитесь к администратору.';
            notice.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#ffefef;color:#700;padding:10px 16px;border-radius:10px;z-index:10000;';
            document.body.appendChild(notice);
            setTimeout(() => notice.remove(), 6000);
        } catch (e) { /* ignore DOM errors */ }
        return;
    }

    const { fb, db } = config;
    // Если fb не содержит нативных функций FieldValue.increment как helper, пробуем подставить
    // совместимый инкремент (если доступен в firebase.firestore.FieldValue)
    if (!fb.increment) {
        if (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue && typeof window.firebase.firestore.FieldValue.increment === 'function') {
            fb.increment = window.firebase.firestore.FieldValue.increment;
        }
    }

    // Импортируем необходимые методы (в коде они использовались как fb/ db-объекты)
    // Предполагаем, что дальнейшее приложение использует совместимый API (getDoc/updateDoc и т.п.)
    // Если вы используете модульный SDK, убедитесь, что ранее на странице подготовлен wrapper (window.fb/window.db).
    const {
        collection, doc, getDoc, setDoc, updateDoc, onSnapshot, deleteDoc, serverTimestamp, getDocs, Timestamp
    } = fb;

    const nodes = {
        // admin
        adminGameControls: document.getElementById('adminGameControls'),
        quizTitleAdmin: document.getElementById('quizTitleAdmin'),
        questionTextAdmin: document.getElementById('questionTextAdmin'),
        progressBarAdmin: document.getElementById('progressBarAdmin'),
        timerAdmin: document.getElementById('timerAdmin'),
        playersAnswersList: document.getElementById('playersAnswersList'),
        liveRanking: document.getElementById('liveRanking'),
        questionCounterAdmin: document.getElementById('questionCounterAdmin'),
        statusTextAdmin: document.getElementById('statusTextAdmin'),
        forceRevealBtn: document.getElementById('forceRevealBtn'),
        endGameBtn: document.getElementById('endGameBtn'),

        // player
        playerGameControls: document.getElementById('playerGameControls'),
        quizTitlePlayer: document.getElementById('quizTitlePlayer'),
        questionTextPlayer: document.getElementById('questionTextPlayer'),
        progressBarPlayer: document.getElementById('progressBarPlayer'),
        timerPlayer: document.getElementById('timerPlayer'),
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

    // session / user data
    let currentLobbyCode = sessionStorage.getItem('currentLobbyCode');
    let myPlayerId = localStorage.getItem('myPlayerId');
    let isHost = !!sessionStorage.getItem('activeQuizId'); // host flag passed from lobby
    let quizData = null;
    let currentQuestionIndex = -1;
    let questionStartAt = null; // Firestore Timestamp
    let questionPhase = null; // 'answering' | 'revealing' | 'waiting'
    let timerInterval = null;
    let playerName = 'Игрок';
    let playerScoreThisQuestion = 0;
    let answeredThisQuestion = false;

    function showToast(message) {
        const t = document.createElement('div');
        t.textContent = message;
        t.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:10px 18px;border-radius:10px;z-index:9999;opacity:0;transition:all .3s';
        document.body.appendChild(t);
        setTimeout(()=> t.style.opacity = '1', 20);
        setTimeout(()=> { t.style.opacity = '0'; setTimeout(()=> t.remove(), 300); }, 2200);
    }

    function showConfirmModal(title, message, onConfirm) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10000;';
        overlay.innerHTML = `<div style="background:#fff;padding:20px;border-radius:14px;max-width:380px;width:92%;text-align:center;">
            <h3 style="margin:0 0 8px">${title}</h3>
            <p style="color:#666;margin:0 0 18px">${message}</p>
            <div style="display:flex;gap:10px">
                <button id="modal-cancel" style="flex:1;padding:10px;border-radius:10px;border:1px solid #ddd;background:#f7f7f7">Отмена</button>
                <button id="modal-confirm" style="flex:1;padding:10px;border-radius:10px;background:#7b3ff2;color:#fff;border:none">Подтвердить</button>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#modal-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#modal-confirm').onclick = () => { onConfirm(); overlay.remove(); };
    }

    // init
    async function init() {
        if (!currentLobbyCode) {
            showToast('Нет активной сессии');
            setTimeout(()=> window.location.href = 'homepage.html', 800);
            return;
        }

        try {
            const sessionSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode));
            if (!sessionSnap.exists()) {
                showToast('Сессия не найдена');
                setTimeout(()=> window.location.href = 'homepage.html', 800);
                return;
            }
            const sessionData = sessionSnap.data();
            const quizSnap = await getDoc(doc(db, 'quizzes', sessionData.quizId));
            if (!quizSnap.exists()) {
                showToast('Викторина не найдена');
                setTimeout(()=> window.location.href = 'homepage.html', 800);
                return;
            }
            quizData = quizSnap.data();

            nodes.quizTitleAdmin.textContent = quizData.title || 'Викторина';
            nodes.quizTitlePlayer.textContent = quizData.title || 'Викторина';
            const qCount = quizData.questions ? quizData.questions.length : 0;
            nodes.questionCounterAdmin.textContent = `Вопрос ${Math.max(0, (sessionData.currentQuestion || 0) + 1)} / ${qCount}`;
            nodes.questionCounterPlayer.textContent = `Вопрос ${Math.max(0, (sessionData.currentQuestion || 0) + 1)} / ${qCount}`;

            if (isHost) {
                nodes.adminGameControls.style.display = 'block';
                nodes.playerGameControls.style.display = 'none';
                setupAdminControls();
            } else {
                nodes.playerGameControls.style.display = 'block';
                nodes.adminGameControls.style.display = 'none';
                if (myPlayerId) {
                    const pSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode, 'players', myPlayerId));
                    if (pSnap.exists()) {
                        const pd = pSnap.data();
                        playerName = pd.name || playerName;
                        nodes.yourTotalScore.textContent = `Общий счёт: ${pd.score || 0}`;
                        nodes.yourTotalTime.textContent = `Общее время: ${pd.totalTime || 0} с`;
                    }
                }
            }

            listenToSession();
        } catch (err) {
            console.error(err);
            showToast('Ошибка загрузки');
        }
    }

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
            showConfirmModal('Завершить игру', 'Вы уверены? Это завершит сессию для всех игроков.', async () => {
                try {
                    await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { status: 'finished' });
                } catch (e) { console.error(e); }
            });
        };
    }

    // Host sequential controller
    let hostLoopRunning = false;
    async function hostControllerIfNeeded(sessionData) {
        if (!isHost) return;
        if (sessionData.status !== 'playing') return;
        if (hostLoopRunning) return;

        hostLoopRunning = true;
        try {
            const totalQuestions = quizData.questions.length;
            let startIndex = typeof sessionData.currentQuestion === 'number' ? sessionData.currentQuestion : 0;

            while (startIndex < totalQuestions) {
                await updateDoc(doc(db, 'active_sessions', currentLobbyCode), {
                    currentQuestion: startIndex,
                    questionPhase: 'answering',
                    questionStartAt: serverTimestamp()
                });

                await sleep(ANSWER_DURATION * 1000);

                await updateDoc(doc(db, 'active_sessions', currentLobbyCode), {
                    questionPhase: 'revealing',
                    revealAt: serverTimestamp()
                });

                // Short reveal for UX
                await sleep(REVEAL_DURATION * 1000);

                await updateDoc(doc(db, 'active_sessions', currentLobbyCode), {
                    questionPhase: 'waiting',
                    waitingStartAt: serverTimestamp()
                });

                await sleep(WAITING_DURATION * 1000);

                startIndex++;
            }

            await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { status: 'finished' });
        } catch (e) {
            console.error('host loop error', e);
        } finally {
            hostLoopRunning = false;
        }
    }

    function sleep(ms){ return new Promise(res => setTimeout(res, ms)); }

    // Listen to session updates
    function listenToSession() {
        onSnapshot(doc(db, 'active_sessions', currentLobbyCode), async (snap) => {
            if (!snap.exists()) {
                showToast('Сессия завершена');
                localStorage.removeItem('myPlayerId');
                sessionStorage.clear();
                setTimeout(()=> window.location.href = 'homepage.html', 800);
                return;
            }
            const data = snap.data();

            if (isHost) {
                nodes.statusTextAdmin.textContent = `Статус: ${data.status || '—'}`;
            }

            if (data.status === 'finished') {
                showFinalResultsUI();
                return;
            }

            const qCount = quizData.questions.length;
            const cur = typeof data.currentQuestion === 'number' ? data.currentQuestion : -1;
            nodes.questionCounterAdmin.textContent = `Вопрос ${Math.max(0, cur + 1)} / ${qCount}`;
            nodes.questionCounterPlayer.textContent = `Вопрос ${Math.max(0, cur + 1)} / ${qCount}`;

            if (isHost && data.status === 'playing') {
                hostControllerIfNeeded(data).catch(console.error);
            }

            if (typeof data.currentQuestion === 'number' && data.currentQuestion !== currentQuestionIndex) {
                currentQuestionIndex = data.currentQuestion;
                questionStartAt = data.questionStartAt || null;
                questionPhase = data.questionPhase || 'answering';
                answeredThisQuestion = false;
                playerScoreThisQuestion = 0;

                const question = quizData.questions[currentQuestionIndex];
                if (!question) return;

                if (isHost) {
                    nodes.questionTextAdmin.textContent = `${currentQuestionIndex + 1}. ${question.question}`;
                } else {
                    nodes.questionTextPlayer.textContent = `${currentQuestionIndex + 1}. ${question.question}`;
                    nodes.playerScoreBlock.style.display = 'none';
                    renderAnswersForPlayer(question);
                    if (myPlayerId) {
                        const pSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode, 'players', myPlayerId));
                        if (pSnap.exists()) {
                            const pd = pSnap.data();
                            nodes.yourTotalScore.textContent = `Общий счёт: ${pd.score || 0}`;
                            nodes.yourTotalTime.textContent = `Общее время: ${pd.totalTime || 0} с`;
                        }
                    }
                }
                startClientTimer();
            } else {
                if (data.questionPhase && data.questionPhase !== questionPhase) {
                    questionPhase = data.questionPhase;
                    if (questionPhase === 'revealing') {
                        showCorrectAnswers();
                        if (!isHost) {
                            nodes.playerScoreBlock.style.display = 'flex';
                            nodes.playerScore.textContent = playerScoreThisQuestion;
                        }
                    }
                }
            }

            if (isHost) {
                syncAdminViews();
            }

            setupAnswersListener();
            setupPlayersRankingListener();
        });
    }

    function startClientTimer() {
        clearInterval(timerInterval);
        timerInterval = setInterval(async () => {
            try {
                const snap = await getDoc(doc(db, 'active_sessions', currentLobbyCode));
                if (!snap.exists()) {
                    clearInterval(timerInterval);
                    return;
                }
                const sess = snap.data();
                const phase = sess.questionPhase || 'answering';

                if (phase === 'answering' && sess.questionStartAt) {
                    const elapsed = Math.floor((Date.now() - sess.questionStartAt.toMillis()) / 1000);
                    let timeLeft = ANSWER_DURATION - elapsed;
                    if (timeLeft < 0) timeLeft = 0;
                    const pct = Math.max(0, (timeLeft / ANSWER_DURATION) * 100);
                    if (isHost) {
                        nodes.progressBarAdmin.style.width = `${pct}%`;
                        nodes.timerAdmin.textContent = `${timeLeft}`;
                    } else {
                        nodes.progressBarPlayer.style.width = `${pct}%`;
                        nodes.timerPlayer.textContent = `${timeLeft}`;
                    }
                } else if (phase === 'revealing') {
                    if (isHost) nodes.timerAdmin.textContent = '...';
                    else nodes.timerPlayer.textContent = '...';
                } else if (phase === 'waiting' && sess.waitingStartAt) {
                    const elapsedW = Math.floor((Date.now() - sess.waitingStartAt.toMillis()) / 1000);
                    let leftW = WAITING_DURATION - elapsedW;
                    if (leftW < 0) leftW = 0;
                    const pctW = Math.max(0, (leftW / WAITING_DURATION) * 100);
                    if (isHost) {
                        nodes.progressBarAdmin.style.width = `${pctW}%`;
                        nodes.timerAdmin.textContent = `${leftW}`;
                    } else {
                        nodes.progressBarPlayer.style.width = `${pctW}%`;
                        nodes.timerPlayer.textContent = `${leftW}`;
                    }
                }
            } catch (err) {
                console.error('timer error', err);
            }
        }, 700);
    }

    function renderAnswersForPlayer(question) {
        nodes.answersList.innerHTML = '';
        answeredThisQuestion = false;
        playerScoreThisQuestion = 0;

        question.answers.forEach((answerText, idx) => {
            const btn = document.createElement('button');
            btn.className = 'answer-btn';
            btn.type = 'button';
            btn.innerHTML = `<div style="flex:1;text-align:left">${answerText}</div>`;
            btn.onclick = async () => {
                if (answeredThisQuestion) return;
                answeredThisQuestion = true;
                btn.classList.add('selected');

                try {
                    const snap = await getDoc(doc(db, 'active_sessions', currentLobbyCode));
                    if (!snap.exists()) return;
                    const session = snap.data();
                    const qStart = session.questionStartAt;
                    const qIdx = session.currentQuestion;
                    const elapsed = qStart ? Math.floor((Date.now() - qStart.toMillis()) / 1000) : 0;
                    const timeTaken = Math.max(0, Math.min(ANSWER_DURATION, elapsed));

                    const correctIdx = quizData.questions[qIdx].correctAnswerIndex;
                    const points = (idx === correctIdx) ? ((timeTaken <= (ANSWER_DURATION / 2)) ? 2 : 1) : 0;
                    playerScoreThisQuestion = points;

                    const answerDocId = `${myPlayerId}_${qIdx}`;
                    await setDoc(doc(db, 'active_sessions', currentLobbyCode, 'answers', answerDocId), {
                        playerId: myPlayerId,
                        playerName,
                        questionIndex: qIdx,
                        selectedIndex: idx,
                        timeTaken,
                        points,
                        submittedAt: serverTimestamp()
                    });

                    // Update player aggregate fields (используем fb.increment если доступен)
                    try {
                        const playerRef = doc(db, 'active_sessions', currentLobbyCode, 'players', myPlayerId);
                        if (fb && typeof fb.increment === 'function') {
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
                            // Fallback: try to read-modify-write (not atomic, but better than nothing)
                            const pSnap = await getDoc(playerRef);
                            if (pSnap.exists()) {
                                const data = pSnap.data();
                                await updateDoc(playerRef, {
                                    score: (data.score || 0) + points,
                                    totalTime: (data.totalTime || 0) + timeTaken,
                                    lastAnsweredAt: serverTimestamp()
                                });
                            }
                        }
                    } catch (e) {
                        console.warn('Не удалось выполнить атомарный increment, применён fallback', e);
                    }

                    showToast(points > 0 ? `Отлично +${points}` : 'Неправильно');
                    nodes.playerScoreBlock.style.display = 'flex';
                    nodes.playerScore.textContent = playerScoreThisQuestion;
                    disableAnswerButtons();
                } catch (e) {
                    console.error('submit answer error', e);
                }
            };
            nodes.answersList.appendChild(btn);
        });
    }

    function disableAnswerButtons() {
        nodes.answersList.querySelectorAll('.answer-btn').forEach(b => b.disabled = true);
    }

    async function showCorrectAnswers() {
        const question = quizData.questions[currentQuestionIndex];
        const buttons = nodes.answersList.querySelectorAll('.answer-btn');
        if (!question) return;
        const correctIdx = question.correctAnswerIndex;

        buttons.forEach((btn, i) => {
            setTimeout(() => {
                btn.classList.remove('selected');
                if (i === correctIdx) btn.classList.add('correct');
                else btn.classList.add('incorrect');
            }, i * 90);
        });
    }

    // Answers listener for admin view
    let answersUnsub = null;
    function setupAnswersListener() {
        if (answersUnsub) return;
        answersUnsub = onSnapshot(collection(db, 'active_sessions', currentLobbyCode, 'answers'), (snap) => {
            nodes.playersAnswersList.innerHTML = '';
            snap.forEach(docSnap => {
                const a = docSnap.data();
                if (a.questionIndex !== currentQuestionIndex) return;
                const div = document.createElement('div');
                div.className = 'player-answer-tag';
                const player = document.createElement('div');
                player.innerHTML = `<div style="font-weight:700">${a.playerName || 'Игрок'}</div>
                                    <div class="meta">Время: ${a.timeTaken}s</div>`;
                const right = document.createElement('div');
                right.style.textAlign = 'right';
                right.innerHTML = `<div class="meta">${a.points > 0 ? 'Правильно' : 'Неверно'}</div>
                                   <div class="score">+${a.points}</div>`;
                div.appendChild(player);
                div.appendChild(right);
                nodes.playersAnswersList.appendChild(div);
            });
        });
    }

    // Players ranking listener
    let playersUnsub = null;
    function setupPlayersRankingListener() {
        if (playersUnsub) return;
        playersUnsub = onSnapshot(collection(db, 'active_sessions', currentLobbyCode, 'players'), (snap) => {
            const players = [];
            snap.forEach(d => {
                const p = d.data();
                players.push({
                    id: d.id,
                    name: p.name || 'Игрок',
                    score: p.score || 0,
                    totalTime: p.totalTime || 0
                });
            });
            players.sort((a,b) => {
                if (b.score !== a.score) return b.score - a.score;
                return a.totalTime - b.totalTime;
            });

            if (isHost) {
                nodes.liveRanking.innerHTML = '';
                players.forEach((p, idx) => {
                    const div = document.createElement('div');
                    div.className = 'player-answer-tag';
                    div.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px">
                                        <span style="font-weight:800">${idx+1}. ${p.name}</span>
                                        <span class="meta">Время ${p.totalTime}s</span>
                                     </div>
                                     <div class="score">${p.score}</div>`;
                    nodes.liveRanking.appendChild(div);
                });
            }

            if (!isHost && myPlayerId) {
                const me = players.find(p => p.id === myPlayerId);
                if (me) {
                    nodes.yourTotalScore.textContent = `Общий счёт: ${me.score}`;
                    nodes.yourTotalTime.textContent = `Общее время: ${me.totalTime} с`;
                }
            }
        });
    }

    function showFinalResultsUI() {
        nodes.adminGameControls.style.display = 'none';
        nodes.playerGameControls.style.display = 'none';
        nodes.finalResults.style.display = 'block';

        const unsub = onSnapshot(collection(db, 'active_sessions', currentLobbyCode, 'players'), (snap) => {
            const players = [];
            snap.forEach(d => {
                const p = d.data();
                players.push({ name: p.name || 'Игрок', score: p.score || 0, totalTime: p.totalTime || 0 });
            });
            players.sort((a,b) => b.score - a.score || a.totalTime - b.totalTime);
            nodes.finalScoresList.innerHTML = '';
            players.forEach((p, idx) => {
                const div = document.createElement('div');
                div.className = 'player-answer-tag';
                div.innerHTML = `<div style="display:flex;flex-direction:column"><span style="font-weight:800">${idx+1}. ${p.name}</span><span class="meta">Время: ${p.totalTime}s</span></div><div class="score">${p.score} баллов</div>`;
                nodes.finalScoresList.appendChild(div);
            });
        });

        nodes.backToHomeBtn.onclick = () => {
            localStorage.removeItem('myPlayerId');
            sessionStorage.clear();
            window.location.href = 'homepage.html';
        };
    }

    // helper to sync admin-specific views (placeholder: used when additional UI updates needed)
    function syncAdminViews() {
        // current implementation updates liveRanking and answers via listeners
    }

    init();

    window.addEventListener('beforeunload', () => {
        clearInterval(timerInterval);
        if (answersUnsub) answersUnsub();
        if (playersUnsub) playersUnsub();
    });
};

document.addEventListener('DOMContentLoaded', startGameProcess);