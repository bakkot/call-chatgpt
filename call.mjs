import fs from 'node:fs';
import path from 'node:path';
import stream from 'node:stream';
import { fileURLToPath } from 'node:url';

import twilio from 'twilio';
import OpenAI, { toFile } from 'openai';
import express from 'express';
import expressWs from 'express-ws';

import { transcode } from './transcode-stream.mjs';
import { chatStream, rechunk } from './chatgpt-stream.mjs';
import { waitForSilence } from './wait-for-silence.mjs';


let __dirname = path.dirname(fileURLToPath(import.meta.url));

let OPENAI_API_KEY = fs.readFileSync(path.join(__dirname, 'OPENAI_KEY.txt'), 'utf8').trim();

let openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

let DOMAIN = fs.readFileSync(path.join(__dirname, 'DOMAIN.txt'), 'utf8').trim();


let app = express();
expressWs(app);

app.post('/voice', (request, response) => {
  console.log('got incoming voice');

  let twiml = new twilio.twiml.VoiceResponse();
  twiml.say('Initializing');
  let connect = twiml.connect();
  connect.stream({
    url: `wss://${DOMAIN}/stream`
  });

  response.type('text/xml');
  response.send(twiml.toString());
});

app.ws('/stream', function(ws, req) {
  ws.on('error', console.error);

  console.log('connected');

  let userStream;

  function recreateUserStream() {
    if (userStream) {
      userStream.done();
    }
    userStream = new UserStream;
  }

  let id = Date.now();

  let state = 'listening';
  recreateUserStream();

  // TODO correctly handle multiple simultaneous streams, I guess?
  // might just work tho
  let streamSid;
  ws.on('message', function(msg) {
    msg = JSON.parse(msg);
    if (msg.event === 'start') {
      streamSid = msg.streamSid;

      // TODO handle multiple messages

      // TODO first send the intro audio

      waitForSilence(userStream, 500, 2500).then(async mp3 => {
        fs.writeFileSync(`./${id}-user-audio.mp3`, mp3);
        let text = await getTextForMp3Bytes(mp3);
        console.log({ text });

        let systemPrompt = `You are a helpful, efficient assistant. Your responses are consise and to-the-point while still retaining some life. You will be connected by phone to a user. If any part of the input is unclear, it's probably a transcription error; figure out what they meant and respond to that.`;
        let messages = [
          { role: 'system', content: systemPrompt },
          // { role: 'user', content: 'You will be connected by phone to a user. Explain to them in a few words that they can interact with you by speaking, that your responses may be inaccurate, and that you are not connected to the internet.' },
          { role: 'user', content: text },
        ];

        let i = 0;
        for await (let para of rechunk(chatStream(messages))) {
          console.log(para);
          console.log('------');

          let mp3Stream = await getMp3StreamForText(para);
          // TODO save audio files also
          // let target = `tts-output-${i++}.mp3`;
          // let outStream = fs.createWriteStream(target);

          await sendMp3StreamToCall(ws, streamSid, mp3Stream);
          console.log('finished sending');

          // TODO mark, re-start userstream
        }
      });

    } else if (msg.event === 'stop') {
      userStream.done();
      userStream = null;
      streamSid = null;
    } else if (msg.event === 'media') {
      if (msg.media.track === 'outbound') {
        return;
      }

      userStream.add(Buffer.from(msg.media.payload, 'base64'));

      return;
    }
    console.log(msg);
  });
});

app.listen(3000, () => {
  console.log(`Listening on port 3000...`);
});

async function getTextForMp3Bytes(bytes) {
  let transcript = await openai.audio.transcriptions.create({
    file: await toFile(bytes, 'placeholder.mp3'),
    model: 'whisper-1',
    language: 'en',
  });
  return transcript.text;
}

async function getMp3StreamForText(input) {
  let res = await openai.audio.speech.create({
    model: 'tts-1',
    input,
    voice: 'fable',
    speed: 1,
  });
  return res.body;
}

async function sendMp3StreamToCall(ws, streamSid, mp3Stream) {
  for await (let chunk of transcode(mp3Stream)) {
    let media = {
      event: 'media',
      streamSid,
      media: {
        payload: chunk.toString('base64'),
      },
    };
    ws.send(JSON.stringify(media));
  }
}

// surely there's a built-in way of doing this...
class UserStream extends stream.Readable {
  waiting = 0;
  chunks = [];

  _read() {
    if (this.chunks.length === 0) {
      ++this.waiting;
    } else {
      this.push(this.chunks.shift());
    }
  }

  add(chunk) {
    if (this.waiting > 0) {
      --this.waiting;
      this.push(chunk);
    } else {
      this.chunks.push(chunk);
    }
  }

  done() {
    this.push(null);
  }
}
