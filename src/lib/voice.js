export const voice = {
    speak: (text, lang = 'en-US', level = 5) => {
        return new Promise((resolve, reject) => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = lang;

            // Adjust rate based on level (1 = 0.7x, 10 = 1.2x)
            // Linear mapping from [1, 10] to [0.7, 1.2]
            const rate = 0.7 + ((level - 1) * (0.5 / 9));
            utterance.rate = Math.max(0.5, Math.min(2.0, rate));

            utterance.onend = () => resolve();
            utterance.onerror = (e) => reject(e);
            window.speechSynthesis.speak(utterance);
        });
    },

    listen: (lang = 'en-US') => {
        return new Promise((resolve, reject) => {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                reject(new Error('Speech recognition not supported in this browser.'));
                return;
            }

            const recognition = new SpeechRecognition();
            recognition.lang = lang;
            recognition.interimResults = false;
            recognition.maxAlternatives = 1;

            recognition.onresult = (event) => {
                const speechToText = event.results[0][0].transcript;
                resolve(speechToText);
            };

            recognition.onerror = (event) => {
                reject(event.error);
            };

            recognition.start();
        });
    }
};
