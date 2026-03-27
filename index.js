const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeStatic = require('ffprobe-static');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeStatic.path);

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());


const FAL_SUBMIT = 'https://queue.fal.run/fal-ai/kling-video/v1.6/standard/text-to-video';
const FAL_QUEUE = 'https://queue.fal.run/fal-ai/kling-video';

async function generateVoiceover(text, elevenKey, voiceId) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': elevenKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg'
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_monolingual_v1',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 }
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs error: ${res.status} - ${err}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const audioPath = `/tmp/audio_${Date.now()}.mp3`;
  fs.writeFileSync(audioPath, buffer);

  const duration = await new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration);
    });
  });

  return { audioPath, duration };
}

async function generateKlingVideo(prompt, falApiKey, durationSeconds) {
  const dur = Math.min(10, Math.max(5, Math.ceil(durationSeconds))).toString();
  const submit = await fetch(FAL_SUBMIT, {
    method: 'POST',
    headers: { 'Authorization': `Key ${falApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      duration: dur,
      aspect_ratio: "9:16",
      negative_prompt: "horizontal, landscape, wide, blur, distort, low quality"
    })
  });
  const submitData = await submit.json();
  console.log('submit:', JSON.stringify(submitData));
  const request_id = submitData.request_id;
  if (!request_id) throw new Error('No request ID from fal.ai');

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 8000));
    const statusRes = await fetch(`${FAL_QUEUE}/requests/${request_id}/status`, {
      headers: { 'Authorization': `Key ${falApiKey}` }
    });
    const statusData = await statusRes.json();
    console.log('status:', statusData.status);
    if (statusData.status === 'COMPLETED') {
      const resultRes = await fetch(`${FAL_QUEUE}/requests/${request_id}`, {
        headers: { 'Authorization': `Key ${falApiKey}` }
      });
      const data = await resultRes.json();
      const videoUrl = data?.video?.url || data?.videos?.[0]?.url;
      if (!videoUrl) throw new Error('No video URL in result');
      return videoUrl;
    }
    if (statusData.status === 'FAILED') throw new Error('Kling generation failed');
  }
  throw new Error('Timed out waiting for video');
}

async function mergeAudioVideo(videoUrl, audioPath) {
  const videoPath = `/tmp/video_${Date.now()}.mp4`;
  const outputPath = `/tmp/output_${Date.now()}.mp4`;

  const videoRes = await fetch(videoUrl);
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
  fs.writeFileSync(videoPath, videoBuffer);

  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions(['-map 0:v', '-map 1:a', '-c:v copy', '-c:a aac', '-shortest'])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  const outputBuffer = fs.readFileSync(outputPath);
  try { fs.unlinkSync(videoPath); fs.unlinkSync(audioPath); fs.unlinkSync(outputPath); } catch(e) {}
  return outputBuffer;
}

app.post('/api/generate-video', async (req, res) => {
  const { prompt, question, falApiKey, elevenKey, voiceId } = req.body;
  if (!prompt || !falApiKey) return res.status(400).json({ error: 'Missing fields' });
  try {
    let audioPath = null;
    let duration = 5;

    if (elevenKey && voiceId && question) {
      console.log('Generating voiceover...');
      const voiceover = await generateVoiceover(question, elevenKey, voiceId);
      audioPath = voiceover.audioPath;
      duration = voiceover.duration;
      console.log(`Voiceover duration: ${duration}s`);
    }

    console.log(`Generating video at ${duration}s...`);
    const videoUrl = await generateKlingVideo(prompt, falApiKey, duration);

    if (audioPath) {
      console.log('Merging audio and video...');
      const mergedBuffer = await mergeAudioVideo(videoUrl, audioPath);
      res.set('Content-Type', 'video/mp4');
      res.set('Content-Disposition', 'attachment; filename="video.mp4"');
      return res.send(mergedBuffer);
    }

    return res.json({ videoUrl });
  } catch(e) {
    console.log('error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 8080;
app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
