import { db } from './db.js';
import { extractVocabularyAndCategory } from './gemini.js';

/**
 * Calculates category weights based on recent history
 * @returns {Array<{category: string, count: number, weight: number}>}
 */
export async function getCategoryWeights() {
    const history = await db.getAllHistory();
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);

    // Filter history to last 24 hours
    const recentHistory = history.filter(h => h.timestamp >= oneDayAgo);

    const counts = {};
    recentHistory.forEach(h => {
        if (!h.category) return;
        counts[h.category] = (counts[h.category] || 0) + 1;
    });

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) return [];

    let weights = Object.keys(counts).map(category => ({
        category,
        count: counts[category],
        weight: (counts[category] / total) * 100
    }));

    // Filter out minor categories (e.g. less than 10% or count < threshold)
    weights = weights.filter(w => w.weight >= 10);

    // Recalculate weights to 100% after dropping minor ones
    const newTotalWeight = weights.reduce((a, b) => a + b.weight, 0);
    weights = weights.map(w => ({
        ...w,
        weight: (w.weight / newTotalWeight) * 100
    }));

    // Apply User Blacklist/Whitelist masks
    const profile = await db.getUserProfile();
    const blacklist = profile?.blacklist || [];

    weights = weights.filter(w => !blacklist.includes(w.category));

    return weights;
}

/**
 * Generates the curriculum (SRS priority + 80% standard, 20% personalized)
 * @param {number} dailyLimit Total words for the day
 */
export async function generateCurriculum(dailyLimit = 10) {
    const allVocab = await db.getAllVocabulary();

    // STEP 18: Cold Start (No scraping history yet)
    if (allVocab.length === 0) {
        return await handleColdStart(dailyLimit);
    }

    const now = Date.now();

    // 1. SRS: Find words that need review today
    const dueForReview = allVocab.filter(v => v.nextReview && v.nextReview <= now);
    let curriculum = dueForReview.slice(0, Math.floor(dailyLimit / 2)); // Up to 50% can be reviews

    if (curriculum.length >= dailyLimit) return curriculum;

    const remainingLimit = dailyLimit - curriculum.length;

    const weights = await getCategoryWeights();
    const personalizedCount = Math.floor(remainingLimit * 0.2); // 20%
    const standardCount = remainingLimit - personalizedCount; // 80%

    // Filter out words already in curriculum
    let unusedVocab = allVocab.filter(v => !curriculum.find(c => c.word === v.word));

    // Pick personalized words
    let personalizedWords = [];
    if (weights.length > 0) {
        // Sort by weight descending
        weights.sort((a, b) => b.weight - a.weight);
        const topCategories = weights.map(w => w.category);

        personalizedWords = unusedVocab.filter(v => topCategories.includes(v.category));

        // Shuffle and slice
        personalizedWords = personalizedWords.sort(() => 0.5 - Math.random()).slice(0, personalizedCount);
    }

    // Pick standard words
    let standardWords = unusedVocab.filter(v => !personalizedWords.includes(v));
    standardWords = standardWords.sort(() => 0.5 - Math.random()).slice(0, standardCount);

    return [...curriculum, ...standardWords, ...personalizedWords];
}

/**
 * Generates an initial session directly from user profile when no scraping history exists.
 */
async function handleColdStart(limit) {
    const { userConfig } = await chrome.storage.local.get(['userConfig']);
    if (!userConfig) return [];

    const promptText = `
        The user wants to learn ${userConfig.language}.
        Level: ${userConfig.level}/10.
        Purpose: ${userConfig.purpose}.
        Interests: ${userConfig.interests.join(', ')}.
        
        Generate ${limit} vocabulary words suited for their level and purpose.
        Format strictly as JSON.
    `;

    // We reuse the existing Gemini extractor function by passing this pseudo-text
    // Note: in a real production environment we might want a dedicated prompt for this, 
    // but this leverages the existing parser.
    try {
        const result = await extractVocabularyAndCategory(promptText);

        // Save these dummy/initial words to DB so they become part of the system
        const dbInstance = await db.init();
        const vocabStore = dbInstance.transaction('vocabulary', 'readwrite').objectStore('vocabulary');

        result.vocabulary.forEach(vData => {
            vocabStore.put({
                word: vData.word,
                level: vData.level,
                meaning: vData.meaning,
                category: "Initial Setup",
                sourceUrl: "onboarding",
                discoveredAt: Date.now(),
                nextReview: Date.now() + (24 * 60 * 60 * 1000)
            });
        });

        // Fetch them back with their new IDs
        const newVocab = await db.getAllVocabulary();
        return newVocab.slice(0, limit);
    } catch (err) {
        console.error("Cold start generation failed:", err);
        return [];
    }
}
