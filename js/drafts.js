document.addEventListener('DOMContentLoaded', async function () {
    const draftsWrapper = document.getElementById('draftsWrapper');
    const { collection, getDocs, doc, deleteDoc, query, orderBy } = window.fb;
    const db = window.db;

    // --- ФУНКЦИЯ КАСТОМНОГО ПОДТВЕРЖДЕНИЯ ---
    function showConfirmModal(title, message, onConfirm) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-title">${title}</div>
                <div class="modal-text">${message}</div>
                <div class="modal-buttons">
                    <button class="btn-confirm">Удалить</button>
                    <button class="btn-cancel">Отмена</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Анимация появления
        setTimeout(() => overlay.classList.add('active'), 10);

        const close = () => {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 300);
        };

        overlay.querySelector('.btn-confirm').onclick = () => {
            onConfirm();
            close();
        };

        overlay.querySelector('.btn-cancel').onclick = close;
        overlay.onclick = (e) => { if(e.target === overlay) close(); };
    }

    function formatFullDate(timestamp) {
        if (!timestamp) return "Дата не указана";
        const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return d.toLocaleString('ru-RU', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    async function loadDrafts() {
        try {
            const draftsQuery = query(collection(db, 'quizzes'), orderBy('createdAt', 'desc'));
            const querySnapshot = await getDocs(draftsQuery);
            draftsWrapper.innerHTML = '';

            if (querySnapshot.empty) {
                draftsWrapper.innerHTML = '<p class="draft-info" style="text-align:center; opacity:0.6; margin-top: 10vw;">У вас пока нет сохраненных викторин</p>';
                return;
            }

            querySnapshot.forEach((documentSnapshot) => {
                const data = documentSnapshot.data();
                const docId = documentSnapshot.id;
                const block = document.createElement('div');
                block.className = 'question-block fade-in';

                block.innerHTML = `
                    <div class="question-header">
                        <h2 class="nqName">${data.title || 'Без названия'}</h2>
                        <button class="delete-btn del-btn-action">
                            <svg viewBox="0 0 24 24" fill="none">
                                <path d="M16 8L8 16M8 8L16 16" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor" stroke-width="2.5"/>
                            </svg>
                        </button>
                    </div>
                    <p class="draft-info">
                        Вопросов: ${data.questionsCount || 0} <br>
                        Добавлено: ${formatFullDate(data.createdAt)} <br>
                        ID: #${data.quizId || '------'}
                    </p>
                    <button class="add-ans edit-btn-action">Продолжить редактирование</button>
                `;

                // ЛОГИКА УДАЛЕНИЯ С НОВЫМ МОДАЛЬНЫМ ОКНОМ
                block.querySelector('.del-btn-action').onclick = (e) => {
                    e.stopPropagation();
                    showConfirmModal(
                        'Удаление', 
                        `Вы уверены, что хотите удалить викторину "${data.title}"?`, 
                        async () => {
                            try {
                                await deleteDoc(doc(db, 'quizzes', docId));
                                block.classList.add('removing');
                                setTimeout(() => block.remove(), 400);
                            } catch (err) {
                                console.error("Ошибка удаления:", err);
                            }
                        }
                    );
                };

                block.querySelector('.edit-btn-action').onclick = () => {
                    sessionStorage.setItem('editQuizId', docId);
                    window.location.href = 'index.html';
                };

                draftsWrapper.appendChild(block);
            });
        } catch (error) {
            console.error("Ошибка:", error);
            draftsWrapper.innerHTML = `<p class="error-hint" style="text-align:center;">Ошибка загрузки</p>`;
        }
    }

    loadDrafts();
});