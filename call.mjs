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
  // twiml.say('Initializing');
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

  let conversation;

  // TODO correctly handle multiple simultaneous streams, I guess?
  // might just work tho
  let streamSid;
  ws.on('message', function(msg) {
    msg = JSON.parse(msg);
    if (msg.event === 'start') {
      conversation = new Conversation(ws, msg.streamSid);

      conversation.init();
    } else if (msg.event === 'stop') {
      conversation.userStream?.done();
      conversation = null;
    } else if (msg.event === 'media') {
      if (conversation.state === 'listening') {
        conversation.userStream.add(Buffer.from(msg.media.payload, 'base64'));
      }
      return;
    } else if (msg.event === 'mark') {
      if (msg.mark.name === 'finished-talking') {
        if (conversation.state !== 'speaking') {
          console.error(`ERROR: got finished-talking message while in state ${conversation.state}`);
          return;
        }
        console.log('finished sending audio');

        conversation.listen();
        return;
      }
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
    speed: 1.25,
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


let systemPrompt = `You are a helpful, efficient assistant. Your responses are consise and to-the-point while still retaining some life. You will be connected by phone to a user. If any part of the input is unclear, it's probably a transcription error; figure out what they meant and respond to that.`;

class Conversation {
  state = '';
  ws;
  streamSid;
  userStream;
  id = Date.now();
  segments = 0;
  messages = [{ role: 'system', content: systemPrompt }];

  constructor(ws, streamSid) {
    this.ws = ws;
    this.streamSid = streamSid;
  }

  async init() {
    this.state = 'speaking';

    console.log('introducing...');
    let toSend = [
      ...this.messages,
      {
        role: 'user',
        content: 'You will be connected by phone to a user. Explain to them in a few words that they can interact with you by speaking, that your responses may be inaccurate, and that you are not connected to the internet.'
      },
    ];

    for await (let para of rechunk(chatStream(toSend))) {
      console.log(para);
      console.log('------');

      let mp3Stream = await getMp3StreamForText(para);
      // TODO save audio files also
      // let target = `tts-output-${i++}.mp3`;
      // let outStream = fs.createWriteStream(target);

      await sendMp3StreamToCall(this.ws, this.streamSid, mp3Stream);
      console.log('finished sending');
    }

    this.ws.send(JSON.stringify({
      event: 'mark',
      streamSid: this.streamSid,
      mark: {
        name: 'finished-talking',
      },
    }));
  }

  listen() {
    console.log('listening...');
    this.state = 'listening';

    this.userStream = new UserStream;

    waitForSilence(this.userStream, 500, 2500).then(async mp3 => {
      this.state = 'speaking';
      console.log('speaking...');

      fs.writeFileSync(`./${this.id}-user-audio-${this.segments++}.mp3`, mp3);
      let text = await getTextForMp3Bytes(mp3);
      console.log({ text });

      this.messages.push({
        role: 'user',
        content: text,
      });

      // let i = 0;
      let botMessage = '';
      for await (let para of rechunk(chatStream(this.messages))) {
        console.log(para);
        botMessage += para + '\n\n';
        console.log('------');

        let mp3Stream = await getMp3StreamForText(para);
        // TODO save audio files also
        // let target = `tts-output-${i++}.mp3`;
        // let outStream = fs.createWriteStream(target);

        await sendMp3StreamToCall(this.ws, this.streamSid, mp3Stream);
        console.log('finished sending');
      }
      this.messages.push({
        role: 'assistant',
        content: botMessage.trim(),
      });

      this.ws.send(JSON.stringify({
        event: 'mark',
        streamSid: this.streamSid,
        mark: {
          name: 'finished-talking',
        },
      }));
    });
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
