import { db } from '../lib/db.js';
import { extractVocabularyAndCategory } from '../lib/gemini.js';

chrome.runtime.onInstalled.addListener(() => {
  console.log('Dive Extension Installed');
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'PAGE_STAY_THRESHOLD_MET') {
    handleScrapedContent(request.data);
  }
});

async function handleScrapedContent(data) {
  try {
    console.log('Processing scraped content from background...', data.title);

    // Get userConfig and check if user is onboarded
    const { onboardingComplete, userConfig } = await chrome.storage.local.get(['onboardingComplete', 'userConfig']);

    if (!onboardingComplete || !userConfig) {
      console.warn('User not fully setup. Skipping extraction.');
      return;
    }

    // 0. Check Session Scheduling Restrictions (Step 14 & 17 prep)
    const now = new Date();
    if (userConfig.learningTime) {
      const [targetHour, targetMinute] = userConfig.learningTime.split(':').map(Number);

      const targetTime = new Date();
      targetTime.setHours(targetHour, targetMinute, 0, 0);

      const targetTimePassed = now >= targetTime;

      // Check if user has completed today's session in storage (stubbed concept)
      const { lastSessionCompletedDate } = await chrome.storage.local.get(['lastSessionCompletedDate']);
      const todayStr = targetTime.toDateString();

      if (targetTimePassed && lastSessionCompletedDate !== todayStr) {
        console.log(`Scraping blocked: Target learning time (${userConfig.learningTime}) reached but session not completed.`);
        // Warn via badge
        chrome.action.setBadgeText({ text: 'WAIT' });
        chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); // Red
        return;
      }
    }

    // 1. Check Root Domain Blocks (Step 17)
    if (userConfig.blockedDomains && userConfig.blockedDomains.length > 0) {
      const urlObj = new URL(data.url);
      if (userConfig.blockedDomains.some(d => urlObj.hostname.includes(d))) {
        console.log(`Scraping blocked: Domain ${urlObj.hostname} is restricted by user.`);
        return;
      }
    }

    // Check Time Blocks (Step 17)
    if (userConfig.blockStartTime && userConfig.blockEndTime) {
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const currentTotalMinutes = currentHour * 60 + currentMinute;

      const [startH, startM] = userConfig.blockStartTime.split(':').map(Number);
      const [endH, endM] = userConfig.blockEndTime.split(':').map(Number);
      const startTotalMinutes = startH * 60 + startM;
      const endTotalMinutes = endH * 60 + endM;

      if (currentTotalMinutes >= startTotalMinutes && currentTotalMinutes <= endTotalMinutes) {
        console.log(`Scraping blocked: Current time is within restricted hours (${userConfig.blockStartTime} - ${userConfig.blockEndTime}).`);
        return;
      }
    }

    // 2. Call Gemini Proxy to extract Category and Vocabulary
    const result = await extractVocabularyAndCategory(data.bodyText);

    // 2. Save history to IndexedDB
    const dbInstance = await db.init();
    const historyStore = dbInstance.transaction('history', 'readwrite').objectStore('history');

    historyStore.add({
      url: data.url,
      title: data.title,
      category: result.category,
      timestamp: Date.now()
    });

    // 3. Save extracted vocabulary to IndexedDB
    const vocabStore = dbInstance.transaction('vocabulary', 'readwrite').objectStore('vocabulary');

    result.vocabulary.forEach(vData => {
      // If word already exists, we might just update review count or ignore. Here we just put.
      vocabStore.put({
        word: vData.word,
        level: vData.level,
        meaning: vData.meaning,
        category: result.category,
        sourceUrl: data.url,
        discoveredAt: Date.now(),
        nextReview: Date.now() + (24 * 60 * 60 * 1000) // 1 day later (SRS base)
      });
    });

    // Update Badge to show scraping activity
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' }); // Green color

    // Clear badge after 3 seconds
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' });
    }, 3000);

    console.log(`Successfully processed ${result.vocabulary.length} words for category [${result.category}]`);
  } catch (error) {
    console.error('Error handling scraped content:', error);
  }
}
