// Content script for Dive: Tracks reading time and extracts main content

const MIN_STAY_MS = 10000; // 10 seconds
const SENSITIVE_URL_PATTERNS = [
    /bank/i, /finance/i, /auth/i, /login/i, /sign-in/i, /password/i,
    /settings/i, /account/i, /payment/i, /checkout/i
];

let visitStartTime = Date.now();
let totalActiveTime = 0;
let lastVisibilityChange = Date.now();
let isScraped = false;

// Security check
function isSafeToScrape() {
    const url = window.location.href;
    return !SENSITIVE_URL_PATTERNS.some(pattern => pattern.test(url));
}

// Extract refined HTML text
function extractRefinedContent() {
    // Clone body to avoid mutating actual DOM
    const clone = document.body.cloneNode(true);

    // Remove unwanted elements: Nav, footer, sidebars, scripts, ads
    const selectorsToRemove = [
        'nav', 'footer', 'aside', 'header', 'script', 'style', 'noscript',
        'iframe', 'svg', '[role="banner"]', '[role="navigation"]',
        '.ad', '.ads', '.advertisement', '#ads', '.sidebar', '.menu',
        '.cookie-banner', '.popup', '.comment', '#comments'
    ];

    selectorsToRemove.forEach(selector => {
        const els = clone.querySelectorAll(selector);
        els.forEach(el => el.remove());
    });

    const title = document.title;
    // Get visible inner text cleanly
    const rawText = clone.innerText || clone.textContent;
    // Compress multiple newlines and spaces
    const refinedText = rawText.replace(/\n\s*\n/g, '\n').replace(/ {2,}/g, ' ').trim();

    // Limit to reasonable context length for Gemini
    const finalText = refinedText.slice(0, 3000);

    return { title, bodyText: finalText, url: window.location.href };
}

// Track active reading time
function handleVisibilityChange() {
    const now = Date.now();
    if (document.visibilityState === 'hidden') {
        totalActiveTime += (now - lastVisibilityChange);
    } else {
        lastVisibilityChange = now;
    }
}

document.addEventListener('visibilitychange', handleVisibilityChange);

// Periodically check if 10s active threshold is met
const timerInterval = setInterval(() => {
    if (isScraped || !isSafeToScrape()) {
        clearInterval(timerInterval);
        return;
    }

    const currentTotal = totalActiveTime + (document.visibilityState === 'visible' ? (Date.now() - lastVisibilityChange) : 0);

    if (currentTotal >= MIN_STAY_MS) {
        clearInterval(timerInterval);
        isScraped = true;

        const content = extractRefinedContent();

        // Ensure there is enough text to be valuable
        if (content.bodyText.length > 200) {
            chrome.runtime.sendMessage({
                action: "PAGE_STAY_THRESHOLD_MET",
                data: content
            });
        }
    }
}, 2000);

// Listen for manual requests from the side panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extractContent") {
        sendResponse(extractRefinedContent());
    }
});
