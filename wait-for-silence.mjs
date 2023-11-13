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
        // TODO: maybe just setting the `d` parameter is sufficient actually?
        if (stderrLine.includes(' silence_start: ')) {
          console.log(stderrLine);
          let time = +stderrLine.split(' silence_start: ')[1];
          if (time * 1000 < offset) {
            console.log('still in intro');
            return;
          }
          console.log('starting wait to see if we get enough silence');
          silenceTimeout = setTimeout(finish, minimum - 500); // 0.5s threshold in command
        } else if (stderrLine.includes(' silence_end: ')) {
          // it's possible to get here before the timeout if the stream gets backed up and is now catching up
          let { 1: end, 2: duration } = stderrLine.match(/silence_end: ([0-9.]+) \| silence_duration: ([0-9.]+)/);
          end = (+end) * 1000;
          duration = (+duration) * 1000;
          clearTimeout(silenceTimeout);
          silenceTimeout = null;

          console.log({ end, duration });

          if (duration > minimum - 500 && end - duration > offset) {
            finish();
          } else {
            console.log(`insufficient silence: ${duration}`);
          }
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

      .audioFilters('silencedetect=n=-30dB:d=0.2')
      // .output('-')
      // .outputFormat('null')
      .output(outputStream)
      .outputFormat('mp3')

      // .on('start', (cmdline) => console.log(cmdline))
      .run();
  });
}
