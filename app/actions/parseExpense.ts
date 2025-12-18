'use server';

import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini
// Note: In production, use process.env.GOOGLE_API_KEY
// For this migration, we'll use the key provided by the user if env is missing, but env is preferred.
const API_KEY = process.env.GOOGLE_API_KEY || 'AIzaSyDQqu5JMGkjKDrSnyqKZnfI0JpXL-ybiL0';
const genAI = new GoogleGenerativeAI(API_KEY);

interface ParseResult {
  amount?: number;
  date?: string; // YYYY-MM-DD
  expenseName?: string;
  category?: string; // Existing or New
  notes?: string;
  isNewCategory?: boolean;
}

export async function parseExpenseAction(transcript: string, existingCategories: string[], expenseContext: string = ''): Promise<ParseResult> {
  if (!transcript) return {};

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
      You are an expense tracking assistant. 
      Extract the following fields from the user's spoken text:
      - expenseName (short title, Capitalized)
      - amount (number)
      - date (YYYY-MM-DD, assume today is ${new Date().toISOString().split('T')[0]})
      - category (Pick valid one from list or suggest a SHORT new one if totally unrelated)
      - notes (any extra details)

      User Text: "${transcript}"

      Existing Categories: ${existingCategories.join(', ')}

      Rules:
      1. If the text mentions "yesterday" or "last friday", calculate the date relative to today.
      2. If a category matches (fuzzy match is ok), use the EXACT name from the list.
      3. Try to fit as much as possbile. If no category fits.suggest a new Capitalized Category Name (max 1-2 words).
      4. HELPFUL CONTEXT: Here are some past expenses and their categories from the user. Use this to infer matches for similar names:
         ${expenseContext}
      5. Return ONLY raw JSON. No markdown formatting.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();

    const parsed = JSON.parse(text);

    // Check if new category
    const isNew = parsed.category && !existingCategories.includes(parsed.category);

    return {
      amount: parsed.amount,
      date: parsed.date,
      expenseName: parsed.expenseName ? parsed.expenseName.charAt(0).toUpperCase() + parsed.expenseName.slice(1) : undefined,
      category: parsed.category,
      notes: parsed.notes,
      isNewCategory: isNew
    };

  } catch (error) {
    console.error("Gemini Parse Error:", error);
    return {};
  }
}
