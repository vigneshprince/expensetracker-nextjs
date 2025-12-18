'use server';

interface SearchResult {
  link: string;
  title: string;
  thumbnail?: string;
}

export async function searchImagesAction(query: string): Promise<string[]> {
  const API_KEY = process.env.GOOGLE_SEARCH_API_KEY;
  const CX = process.env.GOOGLE_SEARCH_CX;

  if (!API_KEY || !CX) {
    console.error("Missing Google Search Keys");
    return [];
  }

  if (!query) return [];

  try {
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&cx=${CX}&key=${API_KEY}&searchType=image&num=10&safe=active`;
    
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      console.error("Google Search Error:", data);
      return [];
    }

    if (data.items) {
      return data.items.map((item: any) => item.link);
    }
    
    return [];

  } catch (error) {
    console.error("Search Action Error:", error);
    return [];
  }
}
