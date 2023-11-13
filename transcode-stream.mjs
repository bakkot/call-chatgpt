import { MPEGDecoder } from 'mpg123-decoder';
import wavefile from 'wavefile';
import resampler from 'wave-resampler';

// The payload must be encoded audio/x-mulaw with a sample rate of 8000
const TARGET_SAMPLE_RATE = 8000;

// we could do this with fluent-ffmpeg
// also the resampler is probably unecessary because wavefile can handle it
// but since I already wrote this code and it works I can't be bothered to fix it
export async function* transcode(mp3Stream) {
  const decoder = new MPEGDecoder();
  await decoder.ready;

  for await (let chunk of mp3Stream) {
    let {channelData, samplesDecoded, sampleRate, errors} = decoder.decode(chunk);
    let samples = channelData[0];

    for (let error of errors) {
      console.error('TRANSCODE ERROR', error);
    }

    // MPEGDecoder gives us 32-bit floats in the interval [-1, 1]
    // WaveFile needs 16-bit integers
    let ints = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; ++i) {
      ints[i] = samples[i] * 32768;
    }

    let resampled = resampler.resample(ints, sampleRate, TARGET_SAMPLE_RATE);

    let wav = new wavefile.WaveFile();

    wav.fromScratch(1, TARGET_SAMPLE_RATE, '16', resampled);
    wav.toMuLaw();
    yield Buffer.from(wav.data.samples);
  }
}
