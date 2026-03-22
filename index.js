const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

const FAL_BASE = 'https://queue.fal.run/fal-ai/kling-video/v1.6/standard';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Submit job and return request_id immediately
app.post('/api/submit-video', async (req, res) => {
  const { prompt, falApiKey } = req.body;
  if (!prompt || !falApiKey) return res.status(400).json({ error: 'Missing fields' });
  try {
    const submit = await fetch(`${FAL_BASE}/text-to-video`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${falApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, duration: "5", aspect_ratio: "9:16" })
    });
    const data = await submit.json();
    return res.json({ request_id: data.request_id });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
});

// Check status of a job
app.post('/api/check-video', async (req, res) => {
  const { request_id, falApiKey } = req.body;
  if (!request_id || !falApiKey) return res.status(400).json({ error: 'Missing fields' });
  try {
    const status = await fetch(`${FAL_BASE}/requests/${request_id}/status`, {
      headers: { 'Authorization': `Key ${falApiKey}`, 'Content-Type': 'application/json' }
    });
    const statusText = await status.text();
    let statusData;
    try { statusData = JSON.parse(statusText); } 
    catch(e) { return res.status(500).json({ error: 'Bad response: ' + statusText }); }
    if (statusData.status === 'COMPLETED') {
      const result = await fetch(`${FAL_BASE}/requests/${request_id}`, {
        headers: { 'Authorization': `Key ${falApiKey}`, 'Content-Type': 'application/json' }
      });
      const resultData = await result.json();
      const videoUrl = resultData?.video?.url || resultData?.videos?.[0]?.url;
      return res.json({ status: 'COMPLETED', videoUrl });
    }
    return res.json({ status: statusData.status || 'UNKNOWN' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
