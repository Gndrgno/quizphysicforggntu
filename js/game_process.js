// Game process logic (module)
const getFirebaseConfig = () => {
    const fb = window.fb || window.firebase;
    const db = window.db || (window.fb ? window.fb.db : null);
    if (fb && db) return { fb, db };
    return null;
};

const ANSWER_DURATION = 10;   // seconds players can answer
const REVEAL_DURATION = 2;    // seconds to show reveal animation
const WAITING_DURATION = 20;  // seconds between questions

const startGameProcess = async () => {
    const config = getFirebaseConfig();
    if (!config) {
        console.warn("Firebase ожидание...");
        setTimeout(startGameProcess, 500);
        return;
    }

    const { fb, db } = config;
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
        t.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:10px 18px;border-radius:20px;z-index:9999;opacity:0;transition:all .3s';
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

        // Load session doc + quiz doc
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

            // UI: fill titles and counts
            nodes.quizTitleAdmin.textContent = quizData.title || 'Викторина';
            nodes.quizTitlePlayer.textContent = quizData.title || 'Викторина';
            const qCount = quizData.questions ? quizData.questions.length : 0;
            nodes.questionCounterAdmin.textContent = `Вопрос ${Math.max(0, (sessionData.currentQuestion || 0) + 1)} / ${qCount}`;
            nodes.questionCounterPlayer.textContent = `Вопрос ${Math.max(0, (sessionData.currentQuestion || 0) + 1)} / ${qCount}`;

            // set role UI
            if (isHost) {
                nodes.adminGameControls.style.display = 'block';
                nodes.playerGameControls.style.display = 'none';
                setupAdminControls();
            } else {
                nodes.playerGameControls.style.display = 'block';
                nodes.adminGameControls.style.display = 'none';
                // load my player data if exists
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
            if (isHost) {
                // host loop will start only if session.status === 'playing'
                // We do not automatically start it here — host started it in lobby by setting status = 'playing'.
                // But we must ensure host initiates question cycle if not started.
            }
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

    // Host sequential controller: only the host executes the loop to keep server timestamps authoritative
    let hostLoopRunning = false;
    async function hostControllerIfNeeded(sessionData) {
        if (!isHost) return;
        if (sessionData.status !== 'playing') return;
        if (hostLoopRunning) return;

        hostLoopRunning = true;
        try {
            const totalQuestions = quizData.questions.length;
            // start from currentQuestion if already exists, else 0
            let startIndex = typeof sessionData.currentQuestion === 'number' ? sessionData.currentQuestion : 0;

            // If server already has questionPhase 'answering' with start timestamp, resume from there.
            // Otherwise, kick off the first question.
            while (startIndex < totalQuestions) {
                // set question start if not set or moved backwards
                await updateDoc(doc(db, 'active_sessions', currentLobbyCode), {
                    currentQuestion: startIndex,
                    questionPhase: 'answering',
                    questionStartAt: serverTimestamp()
                });

                // Wait answer duration (host local timer)
                await sleep(ANSWER_DURATION * 1000);

                // reveal phase
                await updateDoc(doc(db, 'active_sessions', currentLobbyCode), {
                    questionPhase: 'revealing',
                    revealAt: serverTimestamp()
                });

                // short reveal duration to allow animation
                await sleep(REVEAL_DURATION * 1000);

                // waiting phase (show scores and waiting timer)
                await updateDoc(doc(db, 'active_sessions', currentLobbyCode), {
                    questionPhase: 'waiting',
                    waitingStartAt: serverTimestamp()
                });

                // wait waiting duration before next question
                await sleep(WAITING_DURATION * 1000);

                // move to next question
                startIndex++;
            }

            // After all questions finished
            await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { status: 'finished' });
        } catch (e) {
            console.error('host loop error', e);
        } finally {
            hostLoopRunning = false;
        }
    }

    // Helper sleep
    function sleep(ms){ return new Promise(res => setTimeout(res, ms)); }

    // Listen to session, players, answers
    function listenToSession() {
        onSnapshot(doc(db, 'active_sessions', currentLobbyCode), async (snap) => {
            if (!snap.exists()) {
                // session closed
                showToast('Сессия завершена');
                localStorage.removeItem('myPlayerId');
                sessionStorage.clear();
                setTimeout(()=> window.location.href = 'homepage.html', 800);
                return;
            }
            const data = snap.data();

            // update status display
            if (isHost) {
                nodes.statusTextAdmin.textContent = `Статус: ${data.status || '—'}`;
            }

            if (data.status === 'finished') {
                // show final results
                showFinalResultsUI();
                return;
            }

            // Update counters UI
            const qCount = quizData.questions.length;
            const cur = typeof data.currentQuestion === 'number' ? data.currentQuestion : -1;
            nodes.questionCounterAdmin.textContent = `Вопрос ${Math.max(0, cur + 1)} / ${qCount}`;
            nodes.questionCounterPlayer.textContent = `Вопрос ${Math.max(0, cur + 1)} / ${qCount}`;

            // If host needs to run controller, do it
            if (isHost && data.status === 'playing') {
                hostControllerIfNeeded(data).catch(console.error);
            }

            // react to question changes
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
                    // load own player data for updated total score/time display
                    if (myPlayerId) {
                        const pSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode, 'players', myPlayerId));
                        if (pSnap.exists()) {
                            const pd = pSnap.data();
                            nodes.yourTotalScore.textContent = `Общий счёт: ${pd.score || 0}`;
                            nodes.yourTotalTime.textContent = `Общее время: ${pd.totalTime || 0} с`;
                        }
                    }
                }
                startClientTimer(data);
            } else {
                // same question, but phase might change (revealing / waiting)
                if (data.questionPhase && data.questionPhase !== questionPhase) {
                    questionPhase = data.questionPhase;
                    // trigger reveal UI when phase becomes revealing
                    if (questionPhase === 'revealing') {
                        showCorrectAnswers();
                        if (!isHost) {
                            nodes.playerScoreBlock.style.display = 'flex';
                            nodes.playerScore.textContent = playerScoreThisQuestion;
                        }
                    } else if (questionPhase === 'waiting') {
                        // waiting phase UI (progress becomes waiting style)
                        // client timer will handle showing waiting seconds
                    }
                }
            }

            // live ranking and admin answers
            if (isHost) {
                syncAdminViews();
            }

            // players and answers listeners setup
            // keep separate listeners for live updates
            setupAnswersListener();
            setupPlayersRankingListener();
        });
    }

    // Timer that synchronizes clients using server-provided questionStartAt
    function startClientTimer(sessionData) {
        clearInterval(timerInterval);
        // Get question start timestamp from session doc (it should be a Firestore Timestamp)
        if (!sessionData || !sessionData.questionStartAt) {
            // try to read snapshot directly from server doc
            // but here we expect that questionStartAt was set
        }

        // We'll listen directly to session doc to get accurate timestamps when they change
        timerInterval = setInterval(async () => {
            try {
                const snap = await getDoc(doc(db, 'active_sessions', currentLobbyCode));
                if (!snap.exists()) {
                    clearInterval(timerInterval);
                    return;
                }
                const sess = snap.data();
                const qStart = sess.questionStartAt;
                const phase = sess.questionPhase || 'answering';

                if (phase === 'answering' && qStart) {
                    const elapsed = Math.floor((Date.now() - qStart.toMillis()) / 1000);
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

                    // auto-transition to revealing if timeLeft === 0 but server still in answering (fallback)
                    if (timeLeft <= 0 && phase === 'answering') {
                        // ask host to advance; non-host do nothing
                    }
                } else if (phase === 'revealing') {
                    // reveal timer: for nice UX set progress to full/zero depending
                    if (isHost) {
                        nodes.timerAdmin.textContent = '...';
                    } else {
                        nodes.timerPlayer.textContent = '...';
                    }
                } else if (phase === 'waiting') {
                    // waitingStartAt should exist
                    const wStart = sess.waitingStartAt;
                    if (wStart) {
                        const elapsedW = Math.floor((Date.now() - wStart.toMillis()) / 1000);
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
                }
            } catch (err) {
                console.error('timer error', err);
            }
        }, 700);
    }

    // Render answers buttons for player
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

                // Graceful disable visual
                btn.classList.add('selected');
                // compute timeTaken using server questionStartAt (read current session doc)
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

                    // Write answer doc under answers collection with unique id per player+question
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

                    // Update player aggregate fields
                    await updateDoc(doc(db, 'active_sessions', currentLobbyCode, 'players', myPlayerId), {
                        score: fb.increment(points),
                        totalTime: fb.increment(timeTaken),
                        lastAnsweredAt: serverTimestamp()
                    });

                    // Show small feedback
                    showToast(points > 0 ? `Отлично +${points}` : 'Неправильно');
                    // Show score pill
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

    // Show correct / incorrect styles after reveal
    async function showCorrectAnswers() {
        const question = quizData.questions[currentQuestionIndex];
        const buttons = nodes.answersList.querySelectorAll('.answer-btn');
        const correctIdx = question.correctAnswerIndex;

        buttons.forEach((btn, i) => {
            setTimeout(() => {
                btn.classList.remove('selected');
                if (i === correctIdx) {
                    btn.classList.add('correct');
                } else {
                    btn.classList.add('incorrect');
                }
            }, i * 90);
        });
    }

    // Listen to answers collection and update admin view for current question
    let answersUnsub = null;
    function setupAnswersListener() {
        if (answersUnsub) return;
        answersUnsub = onSnapshot(collection(db, 'active_sessions', currentLobbyCode, 'answers'), (snap) => {
            // We will rebuild admin playersAnswersList each snapshot
            nodes.playersAnswersList.innerHTML = '';
            snap.forEach(docSnap => {
                const a = docSnap.data();
                if (a.questionIndex !== currentQuestionIndex) return; // only current question
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

    // Live ranking updates (admin) and player personal info updates
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
            // Sort by score desc then time asc
            players.sort((a,b) => {
                if (b.score !== a.score) return b.score - a.score;
                return a.totalTime - b.totalTime;
            });

            // Admin live ranking UI
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

            // If current client is a player, update their totals
            if (!isHost && myPlayerId) {
                const me = players.find(p => p.id === myPlayerId);
                if (me) {
                    nodes.yourTotalScore.textContent = `Общий счёт: ${me.score}`;
                    nodes.yourTotalTime.textContent = `Общее время: ${me.totalTime} с`;
                }
            }
        });
    }

    // Show final results
    function showFinalResultsUI() {
        // hide other sections
        nodes.adminGameControls.style.display = 'none';
        nodes.playerGameControls.style.display = 'none';
        nodes.finalResults.style.display = 'block';

        // subscribe players once for final
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

    // Initialize listeners and UI
    init();

    // cleanup on unload
    window.addEventListener('beforeunload', () => {
        clearInterval(timerInterval);
        if (answersUnsub) answersUnsub();
        if (playersUnsub) playersUnsub();
    });
};

document.addEventListener('DOMContentLoaded', startGameProcess);