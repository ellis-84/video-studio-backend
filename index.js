const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/generate-video', async (req, res) => {
  const { prompt, falApiKey } = req.body;
  if (!prompt || !falApiKey) return res.status(400).json({ error: 'Missing fields' });
  try {
    const response = await fetch('https://fal.run/fal-ai/kling-video/v1.6/standard/text-to-video', {
      method: 'POST',
      headers: { 'Authorization': `Key ${falApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, duration: "5", aspect_ratio: "9:16" })
    });
    const data = await response.json();
    const videoUrl = data?.video?.url || data?.videos?.[0]?.url;
    if (!videoUrl) return res.status(500).json({ error: 'No video URL', raw: data });
    return res.json({ videoUrl });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
