const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const FAL_SUBMIT = 'https://queue.fal.run/fal-ai/kling-video/v1.6/standard/text-to-video';
const FAL_QUEUE = 'https://queue.fal.run/fal-ai/kling-video';

app.post('/api/generate-video', async (req, res) => {
  const { prompt, falApiKey } = req.body;
  if (!prompt || !falApiKey) return res.status(400).json({ error: 'Missing fields' });
  try {
    const submit = await fetch(FAL_SUBMIT, {
      method: 'POST',
      headers: { 'Authorization': `Key ${falApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, duration: "5", aspect_ratio: "9:16", negative_prompt: "horizontal, landscape, wide, blur, distort, low quality" })
    });
    const submitData = await submit.json();
    console.log('submit:', JSON.stringify(submitData));
    const request_id = submitData.request_id;
    if (!request_id) return res.status(500).json({ error: 'No request ID', raw: submitData });

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
        console.log('result:', JSON.stringify(data));
        const videoUrl = data?.video?.url || data?.videos?.[0]?.url;
        return res.json({ videoUrl });
      }
      if (statusData.status === 'FAILED') return res.status(500).json({ error: 'Generation failed' });
    }
    return res.status(504).json({ error: 'Timed out' });
  } catch(e) {
    console.log('error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
