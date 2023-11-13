import fs from 'node:fs';
import stream from 'node:stream';

import ffmpeg from 'fluent-ffmpeg';

export function waitForSilence(audioStream, offset, minimum) {
  let done = false;
  let silenceTimeout = null;

  let outputChunks = [];
  let outputStream = new stream.Writable({
    write: function (chunk, encoding, next) {
      outputChunks.push(chunk);
      next();
    },
  });

  return new Promise((resolve, reject) => {
    function finish() {
      console.log('got enough silence');
      done = true;
      resolve(Buffer.concat(outputChunks));
      command.kill();
    }

    let command = ffmpeg();
    command
      .on('stderr', function (stderrLine) {
        if (done) {
          return;
        }
        if (stderrLine.includes(' silence_start: ')) {
          console.log(stderrLine);
          let time = +stderrLine.split(' silence_start: ')[1];
          if (time * 1000 < offset) {
            console.log('still in intro');
            return;
          }
          finish();
        }
      })
      .on('error', function(err, stdout, stderr) {
        if (done) {
          return;
        }
        console.log('Error reading stream: ' + err.message);
        done = true;
        reject(err);
      })
      .on('end', () => {
        console.log('stream ended');
      })

      // https://www.twilio.com/docs/voice/twiml/stream#message-start
      .input(audioStream)
      .inputFormat('mulaw')
      .inputOptions('-ar 8000')
      .audioChannels(1)

      .audioFilters(`silencedetect=n=-20dB:d=${(minimum / 1000).toFixed(3)}`)
      // .output('-')
      // .outputFormat('null')
      .output(outputStream)
      .outputFormat('mp3')

      // .on('start', (cmdline) => console.log(cmdline))
      .run();
  });
}
