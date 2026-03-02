import { generateLesson, generateSpeechFeedback } from '../lib/gemini.js';
import { voice } from '../lib/voice.js';
import { db } from '../lib/db.js';
import { getCategoryWeights, generateCurriculum } from '../lib/curriculum.js';

document.addEventListener('DOMContentLoaded', () => {
    const onboarding = document.getElementById('onboarding');
    const learningView = document.getElementById('learning-view');
    const chips = document.querySelectorAll('.chip');
    const levelRange = document.getElementById('language-level');
    const levelDisplay = document.getElementById('level-display');
    const startBtn = document.getElementById('start-learning');
    const detectHistoryBtn = document.getElementById('detect-interests');
    const detectedKeywordsDiv = document.getElementById('detected-keywords');
    const purposeSelect = document.getElementById('learning-purpose');
    const customPurposeInput = document.getElementById('custom-purpose');

    const loginView = document.getElementById('login-view');
    const loginBtn = document.getElementById('google-login-btn');
    const loginError = document.getElementById('login-error');

    let selectedInterests = new Set();
    let historyKeywords = [];

    // Chip selection logic
    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            const value = chip.getAttribute('data-value');
            if (selectedInterests.has(value)) {
                selectedInterests.delete(value);
                chip.classList.remove('selected');
            } else {
                selectedInterests.add(value);
                chip.classList.add('selected');
            }
        });
    });

    // Level range display
    levelRange.addEventListener('input', (e) => {
        levelDisplay.textContent = e.target.value;
    });

    // History detection logic
    detectHistoryBtn.addEventListener('click', async () => {
        detectHistoryBtn.textContent = '분석 중...';
        detectHistoryBtn.disabled = true;

        try {
            // Search last 7 days of history
            const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            const historyItems = await chrome.history.search({
                text: '',
                startTime: oneWeekAgo,
                maxResults: 100
            });

            // Extract keywords from titles (simple extraction for MVP)
            const words = historyItems
                .map(item => item.title)
                .join(' ')
                .split(/\s+/)
                .filter(word => word.length > 2 && !['the', 'and', 'com', 'http'].includes(word.toLowerCase()));

            // Count frequencies
            const freq = {};
            words.forEach(w => freq[w] = (freq[w] || 0) + 1);

            // Get top 5 keywords
            historyKeywords = Object.entries(freq)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(entry => entry[0]);

            renderDetectedKeywords();
            detectHistoryBtn.textContent = '분석 완료 ✨';
            detectHistoryBtn.classList.add('success');
        } catch (err) {
            console.error('History API error:', err);
            detectHistoryBtn.textContent = '분석 실패 (권한 확인 필요)';
            detectHistoryBtn.disabled = false;
        }
    });

    function renderDetectedKeywords() {
        detectedKeywordsDiv.innerHTML = `
            <p class="small-label">분석된 키워드:</p>
            <div class="keyword-container">
                ${historyKeywords.map(k => `<span class="keyword-tag">#${k}</span>`).join('')}
            </div>
        `;
        detectedKeywordsDiv.classList.remove('hidden');
        detectedKeywordsDiv.classList.add('fade-in');
    }

    // Learning purpose toggle
    purposeSelect.addEventListener('change', () => {
        if (purposeSelect.value === 'manual') {
            customPurposeInput.classList.remove('hidden');
            customPurposeInput.focus();
        } else {
            customPurposeInput.classList.add('hidden');
        }
    });

    // Start learning button
    startBtn.addEventListener('click', () => {
        let purpose = purposeSelect.value;
        if (purpose === 'manual') {
            purpose = customPurposeInput.value.trim();
            if (!purpose) {
                alert('학습 목적을 입력해 주세요!');
                customPurposeInput.focus();
                return;
            }
        }

        const config = {
            language: document.getElementById('learning-lang').value,
            interests: Array.from(selectedInterests),
            historyKeywords: historyKeywords,
            level: levelRange.value,
            purpose: purpose,
            learningTime: document.getElementById('learning-time').value || '20:00'
        };

        if (config.interests.length === 0) {
            alert('최소 하나 이상의 관심 주제를 선택해 주세요!');
            return;
        }

        // Save configuration to both IndexedDB and quick storage
        db.saveUserProfile(config)
            .then(() => {
                chrome.storage.local.set({ userConfig: config, onboardingComplete: true }, () => {
                    showLearningView(config);
                });
            })
            .catch(err => {
                console.error('Failed to save user profile to DB:', err);
                alert('프로필 저장 중 오류가 발생했습니다.');
            });
    });

    function showLearningView(config) {
        onboarding.classList.add('hidden');
        learningView.classList.remove('hidden');
        learningView.classList.add('fade-in');

        learningView.innerHTML = `
            <div class="learning-header">
                <h2>학습 진행 중</h2>
                <p>${config.language.toUpperCase()} 레벨 ${config.level} (${config.purpose})</p>
                <div class="action-buttons" style="display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap;">
                    <button id="view-progress" class="primary-btn small-btn">진척도 확인</button>
                    <button id="manage-restrictions" class="secondary-btn small-btn">스크래핑 제한 설정</button>
                    <button id="manage-interests" class="secondary-btn small-btn">관심사 관리</button>
                    <button id="view-history" class="secondary-btn small-btn" style="color: #22d3ee; border-color: #22d3ee;">과거 기록 조회</button>
                    <button id="reset-config" class="secondary-btn small-btn" style="color: #ef4444; border-color: #ef4444;">초기화</button>
                </div>
            </div>
            
            <div id="interests-modal" class="hidden glass-card" style="margin-bottom: 24px; padding: 16px; border: 1px solid var(--accent); border-radius: 12px;">
                <h3>최근 관심사 분석 결과</h3>
                <div id="weights-container" style="margin: 12px 0;">분석 중...</div>
                <button id="close-interests" class="secondary-btn small-btn">닫기</button>
            </div>

            <div class="content-extraction">
                <p class="status-text">오늘의 커리큘럼(80/20)을 가져오는 중입니다...</p>
                <div class="loader"></div>
            </div>
            <div id="lesson-container"></div>
        `;

        document.getElementById('reset-config').addEventListener('click', () => {
            chrome.storage.local.set({ onboardingComplete: false }, () => {
                window.location.reload();
            });
        });

        document.getElementById('manage-interests').addEventListener('click', async () => {
            const modal = document.getElementById('interests-modal');
            modal.classList.remove('hidden');

            const weights = await getCategoryWeights();
            const container = document.getElementById('weights-container');

            if (weights.length === 0) {
                container.innerHTML = '<p style="color: var(--text-secondary); font-size: 0.9rem;">아직 충분한 스크래핑 데이터가 없습니다. 웹서핑을 좀 더 즐겨주세요!</p>';
                return;
            }

            const profile = await db.getUserProfile();
            const blacklist = profile?.blacklist || [];

            container.innerHTML = weights.map(w => `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span>${w.category} (${w.weight.toFixed(1)}%)</span>
                    <button class="toggle-blacklist-btn secondary-btn small-btn ${blacklist.includes(w.category) ? 'danger' : ''}" data-cat="${w.category}">
                        ${blacklist.includes(w.category) ? '차단 해제' : '학습 제외'}
                    </button>
                </div>
            `).join('');

            container.querySelectorAll('.toggle-blacklist-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const cat = e.target.dataset.cat;
                    const p = await db.getUserProfile();
                    let list = p.blacklist || [];

                    if (list.includes(cat)) {
                        list = list.filter(c => c !== cat);
                        e.target.textContent = '학습 제외';
                        e.target.classList.remove('danger');
                    } else {
                        list.push(cat);
                        e.target.textContent = '차단 해제';
                        e.target.classList.add('danger');
                    }

                    await db.saveUserProfile({ ...p, blacklist: list });
                });
            });
        });

        document.getElementById('close-interests').addEventListener('click', () => {
            document.getElementById('interests-modal').classList.add('hidden');
        });

        // History Modal Logic
        const historyModal = document.getElementById('history-modal');
        document.getElementById('view-history').addEventListener('click', async () => {
            historyModal.classList.remove('hidden');
            const historyContainer = document.getElementById('history-container');

            const allVocab = await db.getAllVocabulary();
            if (allVocab.length === 0) {
                historyContainer.innerHTML = '<p class="text-secondary">아직 학습한 단어가 없습니다.</p>';
                return;
            }

            // Group by category for visualization
            const byCategory = {};
            allVocab.forEach(v => {
                if (!byCategory[v.category]) byCategory[v.category] = [];
                byCategory[v.category].push(v);
            });

            historyContainer.innerHTML = Object.keys(byCategory).map(cat => `
                <div style="margin-bottom: 20px;">
                    <h3 style="color: var(--accent); margin-bottom: 12px;">${cat} <span style="font-size: 0.8em; color: var(--text-secondary);">(${byCategory[cat].length} 단어)</span></h3>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        ${byCategory[cat].map(v => `
                            <div class="glass-card" style="padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);">
                                <div style="display: flex; justify-content: space-between;">
                                    <strong>${v.word}</strong>
                                    <span style="font-size: 0.8rem; color: var(--text-secondary);">다음 복습: ${new Date(v.nextReview).toLocaleDateString()}</span>
                                </div>
                                <div style="font-size: 0.9rem; margin-top: 4px;">${v.meaning}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('');
        });

        document.getElementById('close-history').addEventListener('click', () => {
            historyModal.classList.add('hidden');
        });

        // Progress Modal Logic
        const progressModal = document.getElementById('progress-modal');
        document.getElementById('view-progress').addEventListener('click', async () => {
            progressModal.classList.remove('hidden');

            // 1. Calculate Scraped Progress (Assuming 10 words is the daily goal to build a session)
            const todayStart = new Date().setHours(0, 0, 0, 0);
            const history = await db.getAllHistory();
            const todayHistory = history.filter(h => h.timestamp >= todayStart);

            // Just counting history items as a proxy for "preparation progress" 
            // In a real app we'd track actual # of scraped words waiting for the next session
            const currentCount = Math.min(todayHistory.length, 10);
            const progressPercent = (currentCount / 10) * 100;

            document.getElementById('scraping-progress-bar').style.width = `${progressPercent}%`;
            document.getElementById('scraping-progress-text').textContent = `${progressPercent.toFixed(0)}% (${currentCount} / 10 데이터 목록)`;

            // 2. Weights
            const weights = await getCategoryWeights();
            const weightsContainer = document.getElementById('progress-weights-container');

            if (weights.length === 0) {
                weightsContainer.innerHTML = '<p class="text-secondary">충분한 스크래핑 기록이 없습니다.</p>';
            } else {
                weights.sort((a, b) => b.weight - a.weight);
                weightsContainer.innerHTML = weights.slice(0, 5).map((w, index) => `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 6px;">
                        <span style="font-weight: 600;">#${index + 1} ${w.category}</span>
                        <span style="color: var(--accent);">${w.weight.toFixed(1)}%</span>
                    </div>
                `).join('');
            }

            // 3. Recent Websites
            const recentContainer = document.getElementById('recent-websites-container');
            if (todayHistory.length === 0) {
                recentContainer.innerHTML = '<p class="text-secondary">오늘 방문한 기록이 없습니다.</p>';
            } else {
                // Get unique recent sites (last 5)
                const uniqueSites = [];
                const seenUrls = new Set();
                for (let i = todayHistory.length - 1; i >= 0 && uniqueSites.length < 5; i--) {
                    const h = todayHistory[i];
                    if (!seenUrls.has(h.url)) {
                        seenUrls.add(h.url);
                        uniqueSites.push(h);
                    }
                }

                recentContainer.innerHTML = uniqueSites.map(site => `
                    <div class="glass-card" style="padding: 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); font-size: 0.85rem;">
                        <div style="font-weight: 600; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${site.title || 'Untitled'}</div>
                        <div style="color: var(--text-secondary); display: flex; justify-content: space-between;">
                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70%;">${site.url}</span>
                            <span>${new Date(site.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                    </div>
                `).join('');
            }
        });

        document.getElementById('close-progress').addEventListener('click', () => {
            progressModal.classList.add('hidden');
        });

        // Restrictions Modal Logic
        const restrictionsModal = document.getElementById('restrictions-modal');
        document.getElementById('manage-restrictions').addEventListener('click', async () => {
            restrictionsModal.classList.remove('hidden');
            const { userConfig } = await chrome.storage.local.get(['userConfig']);

            // Set Time
            if (userConfig.blockStartTime) document.getElementById('block-start-time').value = userConfig.blockStartTime;
            if (userConfig.blockEndTime) document.getElementById('block-end-time').value = userConfig.blockEndTime;

            // Render Domains
            renderBlockedDomains(userConfig.blockedDomains || []);
        });

        document.getElementById('close-restrictions').addEventListener('click', () => {
            restrictionsModal.classList.add('hidden');
        });

        document.getElementById('save-time-restrictions').addEventListener('click', async () => {
            const start = document.getElementById('block-start-time').value;
            const end = document.getElementById('block-end-time').value;
            const { userConfig } = await chrome.storage.local.get(['userConfig']);

            const newConfig = { ...userConfig, blockStartTime: start, blockEndTime: end };
            await chrome.storage.local.set({ userConfig: newConfig });
            await db.saveUserProfile(newConfig);

            const msg = document.getElementById('time-save-msg');
            msg.classList.remove('hidden');
            setTimeout(() => msg.classList.add('hidden'), 2000);
        });

        document.getElementById('add-domain-btn').addEventListener('click', async () => {
            const input = document.getElementById('domain-input');
            const domain = input.value.trim().toLowerCase();
            if (!domain) return;

            const { userConfig } = await chrome.storage.local.get(['userConfig']);
            let blockedDomains = userConfig.blockedDomains || [];

            if (!blockedDomains.includes(domain)) {
                blockedDomains.push(domain);
                const newConfig = { ...userConfig, blockedDomains };
                await chrome.storage.local.set({ userConfig: newConfig });
                await db.saveUserProfile(newConfig);
                renderBlockedDomains(blockedDomains);
            }
            input.value = '';
        });

        function renderBlockedDomains(domains) {
            const container = document.getElementById('blocked-domains-list');
            if (domains.length === 0) {
                container.innerHTML = '<p class="text-secondary" style="font-size: 0.8rem;">차단된 도메인이 없습니다.</p>';
                return;
            }

            container.innerHTML = domains.map(d => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 6px; font-size: 0.9rem;">
                    <span>${d}</span>
                    <button class="remove-domain-btn" data-domain="${d}" style="background: none; border: none; color: #ef4444; cursor: pointer;">삭제</button>
                </div>
            `).join('');

            container.querySelectorAll('.remove-domain-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const toRemove = e.target.dataset.domain;
                    const { userConfig } = await chrome.storage.local.get(['userConfig']);
                    let blockedDomains = userConfig.blockedDomains || [];
                    blockedDomains = blockedDomains.filter(domain => domain !== toRemove);

                    const newConfig = { ...userConfig, blockedDomains };
                    await chrome.storage.local.set({ userConfig: newConfig });
                    await db.saveUserProfile(newConfig);
                    renderBlockedDomains(blockedDomains);
                });
            });
        }

        // Trigger curriculum generation
        extractAndGenerate();
    }

    async function extractAndGenerate() {
        const container = document.getElementById('lesson-container');
        const statusText = document.querySelector('.status-text');

        try {
            // Wait for DB initialization
            await db.init();

            const dailyVocab = await generateCurriculum(5); // 5 words for demo

            if (dailyVocab.length === 0) {
                statusText.textContent = '아직 추출된 단어가 없습니다. 웹 서핑 시 자동으로 분석됩니다.';
                document.querySelector('.loader')?.classList.add('hidden');
                return;
            }

            const { userConfig } = await chrome.storage.local.get(['userConfig']);

            statusText.textContent = 'AI가 맞춤형 예문과 대화문을 생성하고 있습니다...';

            const lesson = await generateLesson({ vocabList: dailyVocab, userConfig });

            // Mark session as completed for today (Step 14 scheduling logic)
            const targetTimeStr = new Date().toDateString();
            await chrome.storage.local.set({ lastSessionCompletedDate: targetTimeStr });

            renderLesson(lesson, userConfig);
        } catch (error) {
            console.error(error);
            statusText.textContent = '오류 발생: 다시 시도해 주세요.';
        }
    }

    function renderLesson(lesson, userConfig) {
        const targetLang = userConfig.language;
        const container = document.getElementById('lesson-container');
        const statusText = document.querySelector('.status-text');
        statusText.classList.add('hidden');
        document.querySelector('.loader')?.classList.add('hidden');

        container.innerHTML = `
            <div class="word-list fade-in">
                ${lesson.words.map((w, idx) => `
                    <div class="word-card" id="word-${idx}">
                        <div class="word-header">
                            <h3>${w.word}</h3>
                            <button class="voice-btn" data-text="${w.word}">🔊</button>
                        </div>
                        <p class="meaning">${w.meaning}</p>
                        <p class="example"><em>Ex: ${w.example}</em></p>
                        <button class="practice-btn" data-idx="${idx}">대화 연습하기</button>
                    </div>
                `).join('')}
            </div>
            <div id="dialogue-box" class="hidden glass-card">
                 <div id="dialogue-messages"></div>
                 <div id="dialogue-controls">
                     <button id="mic-btn">🎙️ 말하기</button>
                     <button id="close-dialogue">닫기</button>
                 </div>
            </div>
        `;

        // Voice buttons
        container.querySelectorAll('.voice-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                voice.speak(btn.dataset.text, targetLang === 'en' ? 'en-US' : targetLang, userConfig.level);
            });
        });

        // Practice buttons
        container.querySelectorAll('.practice-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                startDialogue(lesson.words[btn.dataset.idx], userConfig);
            });
        });
    }

    async function startDialogue(wordData, userConfig) {
        const targetLang = userConfig.language;
        const dialogueBox = document.getElementById('dialogue-box');
        const messages = document.getElementById('dialogue-messages');
        const micBtn = document.getElementById('mic-btn');
        const closeBtn = document.getElementById('close-dialogue');
        const wordList = document.querySelector('.word-list');

        wordList.classList.add('hidden');
        dialogueBox.classList.remove('hidden');
        messages.innerHTML = '';

        // Initial AI message (from pre-generated dialogue)
        const initialMsg = wordData.dialogue[0];
        addMessage('ai', initialMsg.text);
        await voice.speak(initialMsg.text, targetLang === 'en' ? 'en-US' : targetLang, userConfig.level);

        micBtn.onclick = async () => {
            micBtn.disabled = true;
            micBtn.textContent = '듣고 있어요...';
            try {
                const userSpeech = await voice.listen(targetLang === 'en' ? 'en-US' : targetLang);
                addMessage('user', userSpeech);

                // Re-enable temporarily to show "Thinking"
                micBtn.textContent = '피드백 분석 중...';

                // Get Feedback from Gemini Proxy
                const feedbackData = await generateSpeechFeedback(userSpeech, initialMsg.text, targetLang);

                addMessage('system', `💡 피드백: ${feedbackData.feedback}\n${feedbackData.corrected !== userSpeech ? '교정: ' + feedbackData.corrected : ''}`);

                // Proceed with AI reply if it exists
                if (wordData.dialogue[1]) {
                    setTimeout(async () => {
                        const nextMsg = wordData.dialogue[1];
                        addMessage('ai', nextMsg.text);
                        await voice.speak(nextMsg.text, targetLang === 'en' ? 'en-US' : targetLang, userConfig.level);
                        micBtn.disabled = false;
                        micBtn.textContent = '🎙️ 말하기';
                    }, 500);
                } else {
                    addMessage('system', '대화가 종료되었습니다. 훌륭해요!');
                    micBtn.textContent = '종료';
                }
            } catch (err) {
                console.error(err);
                micBtn.textContent = '🎙️ 다시 시도';
                micBtn.disabled = false;
            }
        };

        closeBtn.onclick = () => {
            dialogueBox.classList.add('hidden');
            wordList.classList.remove('hidden');
        };

        function addMessage(role, text) {
            const div = document.createElement('div');
            div.className = `message ${role}`;
            div.textContent = text;
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
        }
    }

    // Authentication logic
    loginBtn.addEventListener('click', () => {
        loginBtn.disabled = true;
        loginBtn.innerHTML = '로그인 중...';
        loginError.classList.add('hidden');

        chrome.identity.getAuthToken({ interactive: true }, function (token) {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError);
                loginError.textContent = '로그인에 실패했습니다: ' + chrome.runtime.lastError.message;
                loginError.classList.remove('hidden');
                loginBtn.disabled = false;
                loginBtn.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px; vertical-align: middle;">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.16v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.16C1.43 8.55 1 10.22 1 12s.43 3.45 1.16 4.93l3.68-2.84z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.16 7.07l3.68 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Google 계정으로 로그인
                `;
                return;
            }

            // Successfully logged in
            chrome.identity.getProfileUserInfo({ accountStatus: "ANY" }, function (userInfo) {
                chrome.storage.local.set({ authToken: token, userProfile: userInfo }, () => {
                    checkUserState();
                });
            });
        });
    });

    function checkUserState() {
        chrome.storage.local.get(['authToken', 'onboardingComplete', 'userConfig'], (result) => {
            if (!result.authToken) {
                // Show login view
                loginView.classList.remove('hidden');
                onboarding.classList.add('hidden');
                learningView.classList.add('hidden');
            } else if (!result.onboardingComplete) {
                // Show onboarding view
                loginView.classList.add('hidden');
                onboarding.classList.remove('hidden');
                learningView.classList.add('hidden');
            } else {
                // Show learning view
                loginView.classList.add('hidden');
                showLearningView(result.userConfig);
            }
        });
    }

    // Initialize application state
    checkUserState();
});
