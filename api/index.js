import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function searchSerper(query) {
  if (!process.env.SERPER_API_KEY) return null;
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q: query, gl: 'ru', hl: 'ru', num: 3 }),
      signal: AbortSignal.timeout(2000)
    });
    const data = await res.json();
    return data.organic?.map(item => `${item.title}:${item.snippet}`).join('\n') || null;
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Alice webhook is active');
  }

  const { request, session, state, version } = req.body;
  const userText = request?.original_utterance?.trim();

  // Приветствие при старте
  if (session?.new || !userText) {
    return res.json({
      version,
      session,
      response: {
        text: 'Привет! Я на связи с Gemini. О чем поговорим?',
        end_session: false
      }
    });
  }

  try {
    let history = state?.session?.history || [];

    // Проверяем необходимость поиска в сети
    let searchContext = '';
    const needsSearch = /кто|что такое|новости|когда|сейчас|сегодня|курс|погода|последн|вышел/i.test(userText);
    if (needsSearch) {
      const searchResults = await searchSerper(userText);
      if (searchResults) {
        searchContext = `\nАктуальные данные из поиска:\n${searchResults}\n`;
      }
    }

    const systemPrompt = "Ты — голосовой ассистент Алиса. Отвечай кратко, ёмко, по существу, без markdown-разметки (без звездочек и решеток), естественным разговорным языком.";
    const prompt = `${systemPrompt}${searchContext}\nИстория диалога:\n${history.join('\n')}\nПользователь: ${userText}\nАссистент:`;

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    let reply = responseText?.trim() || 'Не удалось сформировать ответ.';
    reply = reply.replace(/[*#_`]/g, '');

    // Сохраняем последние реплики в сессию
    history.push(`U: ${userText}`);
    history.push(`A: ${reply}`);
    if (history.length > 6) history = history.slice(-6);

    return res.json({
      version,
      session,
      session_state: { history },
      response: {
        text: reply,
        end_session: false
      }
    });
  } catch (error) {
    console.error('Error:', error);
    return res.json({
      version,
      session,
      response: {
        text: 'Произошла ошибка при обработке запроса. Попробуйте еще раз.',
        end_session: false
      }
    });
  }
}
