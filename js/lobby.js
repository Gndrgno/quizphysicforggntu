document.addEventListener('DOMContentLoaded', () => {
    const displayCode = document.getElementById('displayCode');
    const quizLink = document.getElementById('quizLink');
    const qrImage = document.getElementById('qrImage');

    // Функция генерации случайного кода
    function generateUniqueCode() {
        // В реальном приложении здесь должен быть запрос к БД для проверки уникальности
        // Для фронтенда генерируем 8 цифр
        const code = Math.floor(10000000 + Math.random() * 90000000).toString();
        
        // Сохраняем код в сессию, чтобы он не менялся при перезагрузке страницы лобби
        if (!sessionStorage.getItem('currentLobbyCode')) {
            sessionStorage.setItem('currentLobbyCode', code);
            return code;
        }
        return sessionStorage.getItem('currentLobbyCode');
    }

    const finalCode = generateUniqueCode();
    const fullUrl = `https://play.myquiz.ru/p/${finalCode}`;

    // Обновляем UI
    displayCode.textContent = finalCode;
    quizLink.value = fullUrl;
    qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(fullUrl)}`;

    // Функция копирования
    window.copyLink = () => {
        quizLink.select();
        document.execCommand('copy');
        
        // Визуальный отклик кнопки
        const btn = document.querySelector('.copy-btn');
        btn.style.color = '#6BCB77';
        setTimeout(() => btn.style.color = '#602EAB', 1000);
    };

    // Обработка кнопок
    document.getElementById('startGame').onclick = () => {
        alert('Викторина запускается!');
        // Переход к первому вопросу
    };

    document.getElementById('stopGame').onclick = () => {
        if(confirm('Вы уверены, что хотите закрыть лобби?')) {
            window.location.href = 'drafts.html';
        }
    };
});