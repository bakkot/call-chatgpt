import * as fs from 'node:fs';
import * as path from 'node:path';
import { URL } from 'node:url';

import OpenAI from 'openai';

let __dirname = new URL('.', import.meta.url).pathname;

let OPENAI_API_KEY = fs.readFileSync(path.join(__dirname, 'OPENAI_KEY.txt'), 'utf8').trim();

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

export async function* chatStream(messages) {
  const stream = await openai.chat.completions.create({
    model: 'gpt-4-1106-preview',
    messages,
    stream: true,
  });
  for await (const chunk of stream) {
    yield chunk.choices[0]?.delta?.content || '';
  }
}

// re-chunk a stream of words into a stream of paragraphs
export async function* rechunk(stream) {
  let current = '';
  for await (const chunk of stream) {
    current += chunk;
    if (current.includes('\n\n')) {
      let paras = current.split('\n\n');
      current = paras.pop();
      for (let para of paras) {
        if (para.trim() === '') continue;
        yield para;
      }
    }
  }
  current = current.trim();
  if (current !== '') {
    yield current;
  }
}
