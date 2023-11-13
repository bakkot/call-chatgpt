# Call ChatGPT

This hooks up twilio, OpenAI's speech-to-text, ChatGPT, and OpenAI's text-to-speech to let you call a regular phone number and talk to ChatGPT.

## Setup

This is a Node.js app.

- Clone the repo.
- Ensure you have `node` set up.
- `npm install` to get dependencies.

You need to be able to expose a port on your machine to the wider internet. [Tailscale funnel](https://tailscale.com/kb/1223/funnel/) works well if you have Tailscale set up already, or alternatively Twilio's docs suggest [ngrok](https://ngrok.com/). The code assumes you'll have a domain name which allows connections over the standard port (443), which either of the previously-mentioned services will provide; if that's not the case for you the code will require tweaking.

- Put your domain name in a file named `DOMAIN.txt` in this directory.

You need a Twilio account with a phone number. They have a pretty generous free trial which is sufficient for demo purposes.

- In the Twilio console, configure the phone number so that under "Voice Configuration" -> "A call comes in" you have "webhook" with URL is "https://your-domain-here.net/voice", where `your-domain-here` is the domain mentioned in the previous part.

You need an OpenAI account, with billing enabled.

- Get (or create) an API key from [this page](https://platform.openai.com/api-keys) and save it in a file named 'OPENAI_KEY.txt' in this directory.

Finally you need ffmpeg.

- Install ffmpeg and ensure it's on your path.


## Use

`node call.js` will run the app and wait for your webhook on port 3000. Make sure you're running `Tailscale funnel` or whatever so that the wider internet can talk to that port.

Then call the number and just talk. You'll need to wait 3 seconds after speaking for it to recognize that you're done and start responding, and responses themselves will also take a couple seconds to begin.

TODO: Right now it only responds to a single message and then stops, because I haven't implemented anything smarter.
