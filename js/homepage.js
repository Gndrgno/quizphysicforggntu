// js/homepage.js

window.addEventListener('load', () => {
    
    // --- ПРОВЕРКА СОХРАНЕНИЯ ВИКТОРИНЫ ---
    if (sessionStorage.getItem('quizSaved') === 'true') {
        showSuccessNotification();
        sessionStorage.removeItem('quizSaved');
    }

    const startBtn = document.getElementById("startNewQuizBtn");
    if (startBtn) {
        startBtn.onclick = () => window.location.href = "newquizpage.html";
    }
    const draftsBtn = document.getElementById("draftsBtn");
    if (draftsBtn) {
        draftsBtn.onclick = () => window.location.href = "draftspage.html";
    }
});

/**
 * Функция создания динамического уведомления (80% ширины)
 */
function showSuccessNotification() {
    const style = document.createElement('style');
    style.innerHTML = `
        .dynamic-notification {
            position: fixed;
            top: -150px;
            left: 50%;
            transform: translateX(-50%);
            
            /* Настройки ширины */
            width: 95%; 
            max-width: 600px; /* Ограничение для десктопов */
            
            background: #8a2be2; 
            color: white;
            padding: 20px;
            border-radius: 16px;
            box-shadow: 0 15px 35px rgba(138, 43, 226, 0.4);
            font-family: 'Segoe UI', sans-serif;
            text-align: center;
            z-index: 10000;
            opacity: 0;
            transition: all 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55);
            box-sizing: border-box; /* Чтобы padding не увеличивал ширину сверх 80% */
        }

        .dynamic-notification.show {
            top: 40px;
            opacity: 1;
        }

        .dynamic-notification.hide {
            top: -150px;
            opacity: 0;
            transform: translateX(-50%) scale(0.9);
        }

        .notification-title {
            display: block;
            font-weight: bold;
            font-size: 18px;
            margin-bottom: 6px;
        }

        .notification-text {
            display: block;
            font-size: 15px;
            opacity: 0.9;
            line-height: 1.4;
        }
    `;
    document.head.appendChild(style);

    const notification = document.createElement('div');
    notification.className = 'dynamic-notification';
    notification.innerHTML = `
        <span class="notification-title">Викторина сохранена!</span>
        <span class="notification-text">Теперь вы можете просмотреть её в разделе «Черновики»</span>
    `;
    document.body.appendChild(notification);

    // Появление
    setTimeout(() => {
        notification.classList.add('show');
    }, 100);

    // Исчезновение
    setTimeout(() => {
        notification.classList.remove('show');
        notification.classList.add('hide');

        // Полное удаление
        setTimeout(() => {
            notification.remove();
            style.remove();
        }, 600);
    }, 2500); // Уведомление висит 2.5 секунды
}