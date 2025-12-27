// Функция для поиска Firebase в глобальной области
const getFirebaseConfig = () => {
    const fb = window.fb || window.firebase;
    const db = window.db || (window.fb ? window.fb.db : null);
    if (fb && db) return { fb, db };
    return null;
};

const startGame = async () => {
    const config = getFirebaseConfig();
    if (!config) {
        console.warn("Firebase ожидание...");
        setTimeout(startGame, 500);
        return;
    }

    const { fb, db } = config;
    const { 
        collection, doc, getDoc, setDoc, updateDoc, 
        onSnapshot, deleteDoc 
    } = fb;

    const nodes = {
        statusTextAdmin: document.getElementById('statusTextAdmin'),
        quizTitleAdmin: document.getElementById('quizTitleAdmin'),
        questionTextAdmin: document.getElementById('questionTextAdmin'),
        timerAdmin: document.getElementById('timerAdmin'),
        playersAnswersList: document.getElementById('playersAnswersList'),
        endGameBtn: document.getElementById('endGameBtn'),
        questionTextPlayer: document.getElementById('questionTextPlayer'),
        timerPlayer: document.getElementById('timerPlayer'),
        answersList: document.getElementById('answersList'),
        playerScoreBlock: document.getElementById('playerScoreBlock'),
        playerScore: document.getElementById('playerScore'),
        adminGameControls: document.getElementById('adminGameControls'),
        playerGameControls: document.getElementById('playerGameControls'),
        finalResults: document.getElementById('finalResults'),
        finalScoresList: document.getElementById('finalScoresList'),
        backToHomeBtn: document.getElementById('backToHomeBtn')
    };

    let currentLobbyCode = sessionStorage.getItem('currentLobbyCode');
    let myPlayerId = localStorage.getItem('myPlayerId');
    let isHost = !!sessionStorage.getItem('activeQuizId');
    let quizData = null;
    let currentQuestionIndex = -1;
    let timerInterval = null;
    let waitingInterval = null;
    let timeLeft = 10;
    let playerPointsThisQuestion = 0;
    let playerName = 'Игрок';

    // Показ загрузки
    function showLoading() {
        if (isHost) {
            nodes.questionTextAdmin.textContent = 'Подготовка вопроса...';
            nodes.timerAdmin.textContent = '--';
        } else {
            nodes.questionTextPlayer.textContent = 'Ожидание начала вопроса...';
            nodes.timerPlayer.textContent = '--';
        }
    }

    // Toast
    function showToast(message) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
            background: #333; color: #fff; padding: 12px 24px; border-radius: 50px;
            font-size: 14px; z-index: 10001; opacity: 0; transition: all 0.3s ease;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.style.opacity = '1', 10);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }

    // Модалка подтверждения
    function showConfirmModal(title, message, onConfirm) {
        const overlay = document.createElement('div');
        overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; justify-content: center; align-items: center; z-index: 10000; opacity: 0; transition: all 0.3s ease; backdrop-filter: blur(4px);`;
        overlay.innerHTML = `<div style="background:#fff;width:320px;border-radius:16px;padding:24px;text-align:center;transform:scale(0.8);transition:all 0.3s ease;box-shadow:0 10px 25px rgba(0,0,0,0.2);">
            <div style="color:#1a1a1a;font-size:20px;font-weight:700;margin-bottom:12px;">${title}</div>
            <div style="color:#666;font-size:15px;line-height:1.5;margin-bottom:24px;">${message}</div>
            <div style="display:flex;gap:12px;">
                <button id="modal-cancel" style="flex:1;padding:12px;border-radius:12px;border:1px solid #e0e0e0;background:#f5f5f5;color:#333;font-weight:600;cursor:pointer;">Отмена</button>
                <button id="modal-confirm" style="flex:1;padding:12px;border-radius:12px;background:#8a2be2;color:#fff;font-weight:600;cursor:pointer;border:none;">Подтвердить</button>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        setTimeout(() => overlay.style.opacity = '1', 10);
        const close = () => {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 300);
        };
        overlay.querySelector('#modal-confirm').onclick = () => { onConfirm(); close(); };
        overlay.querySelector('#modal-cancel').onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
    }

    // Инициализация игры
    async function initGame() {
        const sessionSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode));
        if (!sessionSnap.exists()) {
            window.location.href = 'homepage.html';
            return;
        }

        const sessionData = sessionSnap.data();
        const quizSnap = await getDoc(doc(db, 'quizzes', sessionData.quizId));
        if (!quizSnap.exists()) {
            showToast('Викторина не найдена');
            return;
        }
        quizData = quizSnap.data();

        if (isHost) {
            nodes.adminGameControls.style.display = 'block';
            nodes.playerGameControls.style.display = 'none';
            nodes.quizTitleAdmin.textContent = quizData.title;
            nodes.statusTextAdmin.textContent = 'Игра в процессе';
            setupAdminControls();
        } else {
            nodes.playerGameControls.style.display = 'block';
            nodes.adminGameControls.style.display = 'none';
            const playerSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode, 'players', myPlayerId));
            if (playerSnap.exists()) {
                playerName = playerSnap.data().name;
            }
        }

        listenToGameState();
    }

    function setupAdminControls() {
        nodes.endGameBtn.onclick = () => {
            showConfirmModal('Завершить игру', 'Вы уверены, что хотите завершить игру?', async () => {
                await deleteDoc(doc(db, 'active_sessions', currentLobbyCode));
                sessionStorage.clear();
                window.location.href = 'homepage.html';
            });
        };
    }

    function listenToGameState() {
        onSnapshot(doc(db, 'active_sessions', currentLobbyCode), (snap) => {
            if (!snap.exists()) {
                if (!isHost) {
                    showToast("Игра завершена администратором.");
                    localStorage.removeItem('myPlayerId');
                    sessionStorage.clear();
                    setTimeout(() => window.close(), 1500);
                }
                return;
            }
            const data = snap.data();
            if (data.status === 'finished') {
                showFinalResults();
                return;
            }
            if (data.status !== 'playing') {
                window.location.href = 'lobby.html';
                return;
            }

            const newIndex = data.currentQuestion || 0;

            if (newIndex !== currentQuestionIndex) {
                currentQuestionIndex = newIndex;
                const question = quizData.questions[currentQuestionIndex];

                if (isHost) {
                    nodes.questionTextAdmin.textContent = question.question;
                } else {
                    nodes.questionTextPlayer.textContent = question.question;
                    nodes.playerScoreBlock.style.display = 'none';
                    renderAnswersForPlayer(question);
                }

                startQuestionTimer();
            }
        });

        if (isHost) {
            onSnapshot(collection(db, 'active_sessions', currentLobbyCode, 'answers'), (snapshot) => {
                nodes.playersAnswersList.innerHTML = '';
                snapshot.forEach((docSnap) => {
                    const ans = docSnap.data();
                    if (ans.questionIndex === currentQuestionIndex) {
                        const tag = document.createElement('div');
                        tag.className = 'player-answer-tag fade-in';
                        tag.innerHTML = `
                            <span>${ans.playerName || 'Игрок'}</span>
                            <span class="answer-status">${ans.points > 0 ? 'Правильно' : 'Неправильно'}</span>
                            <span class="score">+${ans.points}</span>
                            <span class="time">${ans.timeTaken} сек</span>
                        `;
                        nodes.playersAnswersList.appendChild(tag);
                    }
                });
            });
        }
    }

    function renderAnswersForPlayer(question) {
        nodes.answersList.innerHTML = '';
        question.answers.forEach((answer, idx) => {
            const btn = document.createElement('button');
            btn.className = 'answer-btn';
            btn.textContent = answer;
            btn.onclick = async () => {
                if (timeLeft <= 0) return;

                const timeTaken = 10 - timeLeft;
                const points = idx === question.correctAnswerIndex 
                    ? (timeTaken <= halfTime ? 2 : 1)
                    : 0;

                playerPointsThisQuestion = points;

                await setDoc(doc(db, 'active_sessions', currentLobbyCode, 'answers', myPlayerId), {
                    playerName,
                    questionIndex: currentQuestionIndex,
                    selectedIndex: idx,
                    timeTaken,
                    points
                });

                await updateDoc(doc(db, 'active_sessions', currentLobbyCode, 'players', myPlayerId), {
                    score: firebase.firestore.FieldValue.increment(points)
                });

                btn.classList.add('selected');
                disableAnswerButtons();
                showToast(points > 0 ? 'Правильно!' : 'Неправильно');
            };
            nodes.answersList.appendChild(btn);
        });
    }

    function disableAnswerButtons() {
        nodes.answersList.querySelectorAll('.answer-btn').forEach(b => b.disabled = true);
    }

    function startQuestionTimer() {
        clearInterval(timerInterval);
        clearInterval(waitingInterval);
        const progressBar = isHost ? nodes.progressBarAdmin : nodes.progressBarPlayer;
        const waitingProgress = isHost ? nodes.waitingProgressAdmin : nodes.waitingProgressPlayer;
        const waitingSeconds = isHost ? nodes.waitingSecondsAdmin : nodes.waitingSecondsPlayer;

        progressBar.style.width = '100%';
        waitingProgress.style.display = 'none';

        timeLeft = 10;

        timerInterval = setInterval(() => {
            timeLeft--;
            progressBar.style.width = `${(timeLeft / 10) * 100}%`;

            if (timeLeft <= 0) {
                clearInterval(timerInterval);
                showCorrectAnswers();

                if (!isHost) {
                    nodes.playerScoreBlock.style.display = 'flex';
                    nodes.playerScore.textContent = playerPointsThisQuestion;
                }

                startWaitingTimer(waitingProgress, waitingSeconds);
            }
        }, 1000);
    }

    function startWaitingTimer(waitingProgress, waitingSeconds) {
        waitingProgress.style.display = 'block';
        let waitSeconds = 5;
        waitingSeconds.textContent = waitSeconds;

        waitingInterval = setInterval(() => {
            waitSeconds--;
            waitingSeconds.textContent = waitSeconds;

            if (waitSeconds <= 0) {
                clearInterval(waitingInterval);
                if (isHost && currentQuestionIndex < quizData.questions.length - 1) {
                    startQuestion(currentQuestionIndex + 1);
                } else if (isHost) {
                    endGame();
                }
            }
        }, 1000);
    }

    function showCorrectAnswers() {
        if (isHost) return;

        const buttons = nodes.answersList.querySelectorAll('.answer-btn');
        const correctIdx = quizData.questions[currentQuestionIndex].correctAnswerIndex;

        buttons.forEach((btn, i) => {
            if (i === correctIdx) {
                btn.classList.add('correct');
            } else {
                btn.classList.add('incorrect');
            }
        });
    }

    async function startQuestion(index) {
        await updateDoc(doc(db, 'active_sessions', currentLobbyCode), {
            currentQuestion: index
        });
    }

    async function endGame() {
        await updateDoc(doc(db, 'active_sessions', currentLobbyCode), { status: 'finished' });
    }

    function showFinalResults() {
        nodes.adminGameControls.style.display = 'none';
        nodes.playerGameControls.style.display = 'none';
        nodes.finalResults.style.display = 'block';

        onSnapshot(collection(db, 'active_sessions', currentLobbyCode, 'players'), (snap) => {
            nodes.finalScoresList.innerHTML = '';
            snap.forEach((playerDoc) => {
                const playerData = playerDoc.data();
                const div = document.createElement('div');
                div.className = 'player-answer-tag fade-in';
                div.innerHTML = `
                    <span>${playerData.name || 'Игрок'}</span>
                    <span class="score">${playerData.score || 0} баллов</span>
                `;
                nodes.finalScoresList.appendChild(div);
            });
        });

        nodes.backToHomeBtn.onclick = () => {
            localStorage.removeItem('myPlayerId');
            sessionStorage.clear();
            window.location.href = 'homepage.html';
        };
    }

    initGame();
};

document.addEventListener('DOMContentLoaded', startGame);