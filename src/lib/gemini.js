// Basic structure for Gemini API integration
/**
/**
 * @param {Object} context - { vocabList, userConfig }
 */
export async function generateLesson(context) {
  const { vocabList, userConfig } = context;

  const vocabString = vocabList.map(v => `${v.word} (from ${v.category} page: ${v.sourceUrl || ''})`).join('\n');

  const prompt = `
        You are an expert language teacher. 
        User is learning ${userConfig.language} at level ${userConfig.level}/10. 
        Their goal is ${userConfig.purpose}.
        
        Generate personalized learning content for the following 5 vocabulary words the user recently encountered:
        ---
        ${vocabString}
        ---
        
        Based on these words and the user's level, provide:
        For each word: The word, its meaning, an example sentence suitable for their purpose, and a short dialogue context (2-3 lines).
        
        Respond ONLY in JSON format like this:
        {
          "words": [
            {
              "word": "...",
              "meaning": "...",
              "example": "...",
              "dialogue": [
                {"role": "A", "text": "..."},
                {"role": "B", "text": "..."}
              ]
            }
          ]
        }
    `;

  try {
    const response = await fetch(`http://localhost:3000/api/gemini/generate-lesson`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Gemini API Error:', error);
    throw error;
  }
}

/**
 * Extracts category and general vocabulary from scraped text.
 * Filters out proper nouns and sensitive personal data.
 * @param {string} text - Scraped text
 */
export async function extractVocabularyAndCategory(text) {
  const prompt = `
      Analyze the following web page content:
      ---
      ${text}
      ---
      
      Tasks:
      1. Determine the main category/topic of this text (e.g., Tech, Travel, Cooking, Business, Science, Lifestyle).
      2. Extract 5-10 highly useful general vocabulary words from the text (levels L1 to L10).
      3. **SECURITY FILTER**: Do NOT extract any proper nouns (brand names, personal names, locations).
      4. **SECURITY FILTER**: Do NOT extract any personal information, IDs, or financial terms that look specific to an individual.
      
      Respond ONLY in JSON format like this:
      {
        "category": "Main Category Name",
        "vocabulary": [
          {"word": "general_word1", "level": "L3", "meaning": "definition"},
          {"word": "general_word2", "level": "L5", "meaning": "definition"}
        ]
      }
  `;

  try {
    const response = await fetch(`http://localhost:3000/api/gemini/extract-vocabulary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Gemini Extraction Error:', error);
    throw error;
  }
}

/**
 * Analyzes the user's spoken text and provides feedback.
 */
export async function generateSpeechFeedback(userSpeech, expectedContext, lang) {
  const prompt = `
      The user is learning ${lang}. They were practicing a dialogue related to this context: "${expectedContext}".
      The user said: "${userSpeech}"
      
      Provide brief feedback on their grammar, naturalness, and meaning.
      If it's perfect, say so encouragingly. If there are minor errors, use "Recasting" (saying the correct version back naturally).
      
      Respond ONLY in JSON format:
      {
         "feedback": "Your short, friendly feedback message to the user",
         "corrected": "The natural/corrected way to say it (if needed)"
      }
  `;

  try {
    const response = await fetch(`http://localhost:3000/api/gemini/speech-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Gemini Feedback Error:', error);
    return { feedback: "Great effort! (Feedback unavailable)", corrected: userSpeech };
  }
}
