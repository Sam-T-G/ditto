const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({});
ai.models.generateContent({
  model: 'gemini-3.1-pro-preview',
  contents: 'hello'
}).then(res => console.log('success!', res.text)).catch(e => console.error('error!', e.message));
