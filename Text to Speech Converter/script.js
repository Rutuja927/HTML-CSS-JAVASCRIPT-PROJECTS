       function speak() {
            const utter = new SpeechSynthesisUtterance();
            utter.rate = 1.0; // speed: 0.1-10
            utter.volume = 1.0; // 0-1
            utter.pitch = 0.5; // 0 (low) - 2 (high)
            utter.voice = speechSynthesis.getVoices()[0];
            utter.text = document.querySelector('#txt').value;
            speechSynthesis.speak(utter);
        }
