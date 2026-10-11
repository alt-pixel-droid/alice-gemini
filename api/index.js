import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

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
  // Для GET-проверки в браузере
  if (req.method !== 'POST') {
    return res.status(200).send('Alice webhook is active');
  }

  try {
    // Безопасное получение тела запроса
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = {};
      }
    }

    const { request, session, state, version = '1.0' } = body || {};
    const userText = request?.original_utterance?.trim();

    // Старт сессии или пустое приветствие
    if (session?.new || !userText) {
      return res.status(200).json({
        version,
        session,
        response: {
          text: 'Привет! Я на связи с Gemini. О чем поговорим?',
          end_session: false
        }
      });
    }

    let history = state?.session?.history || [];

    // Проверка необходимости поиска
    let searchContext = '';
    const needsSearch = /кто|что такое|новости|когда|сейчас|сегодня|курс|погода|последн|вышел/i.test(userText);
    if (needsSearch) {
      const searchResults = await searchSerper(userText);
      if (searchResults) {
        searchContext = `\nАктуальные данные из поиска:\n${searchResults}\n`;
      }
    }

    const systemPrompt = "Ты — голосовой ассистент. Отвечай кратко, ёмко, по существу, без markdown-разметки (без звездочек, жирного текста и решеток), естественным разговорным языком.";
    const prompt = `${systemPrompt}${searchContext}\nИстория диалога:\n${history.join('\n')}\nПользователь: ${userText}\nАссистент:`;

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(prompt);
    let reply = result.response.text()?.trim() || 'Не удалось получить ответ.';
    reply = reply.replace(/[*#_`]/g, '');

    // Запоминаем контекст
    history.push(`U: ${userText}`);
    history.push(`A: ${reply}`);
    if (history.length > 6) history = history.slice(-6);

    return res.status(200).json({
      version,
      session,
      session_state: { history },
      response: {
        text: reply,
        end_session: false
      }
    });
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(200).json({
      version: req.body?.version || '1.0',
      session: req.body?.session || {},
      response: {
        text: 'Произошла ошибка при обращении к нейросети, попробуйте еще раз.',
        end_session: false
      }
    });
  }
}
