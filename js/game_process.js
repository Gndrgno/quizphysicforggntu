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
        questionTextAdmin: document.getElementById('questionTextAdmin'),
        progressBar: document.getElementById('progressBar'),
        waitingProgress: document.getElementById('waitingProgress'),
        waitingSeconds: document.getElementById('waitingSeconds'),
        playersAnswersList: document.getElementById('playersAnswersList'),
        endGameBtn: document.getElementById('endGameBtn'),
        questionTextPlayer: document.getElementById('questionTextPlayer'),
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

    function showToast(message) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:14px 28px;border-radius:50px;font-size:15px;z-index:10001;opacity:0;transition:all 0.4s ease;box-shadow:0 6px 20px rgba(0,0,0,0.3);';
        document.body.appendChild(toast);
        setTimeout(() => toast.style.opacity = '1', 10);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 400);
        }, 2500);
    }

    async function initGame() {
        const sessionSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode));
        if (!sessionSnap.exists()) {
            window.location.href = 'homepage.html';
            return;
        }

        const sessionData = sessionSnap.data();
        const quizSnap = await getDoc(doc(db, 'quizzes', sessionData.quizId));
        if (!quizSnap.exists()) return;
        quizData = quizSnap.data();

        if (isHost) {
            nodes.adminGameControls.style.display = 'block';
            nodes.playerGameControls.style.display = 'none';
            setupAdminControls();
        } else {
            nodes.playerGameControls.style.display = 'block';
            nodes.adminGameControls.style.display = 'none';
            const playerSnap = await getDoc(doc(db, 'active_sessions', currentLobbyCode, 'players', myPlayerId));
            if (playerSnap.exists()) {
                playerName = playerSnap.data().name || 'Игрок';
            }
        }

        listenToGameState();
    }

    function setupAdminControls() {
        nodes.endGameBtn.onclick = () => {
            if (confirm('Завершить игру для всех игроков?')) {
                deleteDoc(doc(db, 'active_sessions', currentLobbyCode)).then(() => {
                    sessionStorage.clear();
                    window.location.href = 'homepage.html';
                });
            }
        };
    }

    function listenToGameState() {
        onSnapshot(doc(db, 'active_sessions', currentLobbyCode), (snap) => {
            if (!snap.exists()) {
                showToast("Игра завершена");
                setTimeout(() => window.location.href = 'homepage.html', 2000);
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

            const newIndex = data.currentQuestion ?? 0;

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
                        tag.className = 'player-answer-tag';
                        tag.innerHTML = `
                            <span>${ans.playerName || 'Игрок'}</span>
                            <span class="answer-status">${ans.points > 0 ? 'Правильно' : 'Неправильно'}</span>
                            <span class="score">+${ans.points}</span>
                            <span class="time">${ans.timeTaken}с</span>
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
                    ? (timeTaken <= 5 ? 2 : 1)
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
                    score: fb.firebase.firestore.FieldValue.increment(points)
                });

                btn.classList.add('selected');
                disableAnswerButtons();
                showToast(points > 0 ? `Правильно! +${points}` : 'Неправильно');
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
        nodes.progressBar.style.width = '100%';
        nodes.waitingProgress.style.display = 'none';

        timeLeft = 10;

        timerInterval = setInterval(() => {
            timeLeft--;
            nodes.progressBar.style.width = `${(timeLeft / 10) * 100}%`;

            if (timeLeft <= 0) {
                clearInterval(timerInterval);
                showCorrectAnswers();

                if (!isHost) {
                    nodes.playerScoreBlock.style.display = 'flex';
                    nodes.playerScore.textContent = playerPointsThisQuestion;
                }

                startWaitingTimer();
            }
        }, 1000);
    }

    function startWaitingTimer() {
        nodes.waitingProgress.style.display = 'block';
        let wait = 5;
        nodes.waitingSeconds.textContent = wait;

        waitingInterval = setInterval(() => {
            wait--;
            nodes.waitingSeconds.textContent = wait;

            if (wait <= 0) {
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
            if (i === correctIdx) btn.classList.add('correct');
            else btn.classList.add('incorrect');
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
            const players = [];
            snap.forEach(doc => {
                const data = doc.data();
                players.push({ name: data.name || 'Игрок', score: data.score || 0 });
            });
            players.sort((a, b) => b.score - a.score);

            nodes.finalScoresList.innerHTML = '';
            players.forEach(p => {
                const div = document.createElement('div');
                div.className = 'player-answer-tag';
                div.innerHTML = `<span>${p.name}</span><span class="score">${p.score} баллов</span>`;
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