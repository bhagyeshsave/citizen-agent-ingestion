// index.js for Agent 2: Summarization & Extraction
const express = require('express');
const { SpeechClient } = require('@google-cloud/speech');
const { VertexAI } = require('@google-cloud/vertexai');
const Busboy = require('busboy'); // For parsing multipart/form-data

const app = express();
const speechClient = new SpeechClient();
const vertexAI = new VertexAI({ project: process.env.GCP_PROJECT_ID, location: 'us-central1' });

// Initialize the Gemini Pro model
const generativeModel = vertexAI.getGenerativeModel({ model: 'gemini-1.0-pro' });

// URL for the next agent in the chain (Agent 1)
const VALIDATION_AGENT_URL = 'YOUR_AGENT_1_VALIDATION_URL';

app.post('/submit', (req, res) => {
  const busboy = Busboy({ headers: req.headers });
  const fields = {};
  let reportText = '';

  busboy.on('field', (fieldname, val) => {
    fields[fieldname] = val;
  });

  busboy.on('file', async (fieldname, file, filename) => {
    // For this example, we only process audio files for transcription
    if (fieldname === 'audio') {
      const chunks = [];
      file.on('data', (chunk) => chunks.push(chunk));
      file.on('end', async () => {
        const audioBytes = Buffer.concat(chunks).toString('base64');
        const [response] = await speechClient.recognize({
          audio: { content: audioBytes },
          config: { encoding: 'WEBM_OPUS', sampleRateHertz: 48000, languageCode: 'en-US' } // Adjust encoding as needed
        });
        reportText = response.results.map(result => result.alternatives[0].transcript).join('\n');
      });
    }
  });

  busboy.on('finish', async () => {
    // If text was provided directly, use it. Otherwise, use transcribed text.
    const initialText = fields.description || reportText;
    if (!initialText) {
      return res.status(400).json({ error: 'No text or audio provided.' });
    }

    // Use Gemini to summarize and structure the data
    const prompt = `Summarize the following citizen report in one clear sentence. Extract the core issue. Report: "${initialText}"`;
    const [result] = await generativeModel.generateContent([prompt]);
    const summary = result.response.candidates[0].content.parts[0].text;

    const structuredReport = {
      citizen_id: fields.citizen_id,
      original_text: initialText,
      summary: summary,
      location: fields.location, // e.g., "40.7128,-74.0060"
      photo_urls: fields.photo_urls ? fields.photo_urls.split(',') : [],
      // The rest of the chain will use this structured data
    };
    
    // --- CHAIN TO AGENT 1 ---
    try {
        const validationResponse = await axios.post(VALIDATION_AGENT_URL, structuredReport);
        res.status(200).json(validationResponse.data);
    } catch (error) {
        res.status(500).json({ error: "Failed to call validation agent.", details: error.message });
    }
  });

  req.pipe(busboy);
});

// Deploy this as a Cloud Function