const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const PORT = 3000;

// Replace with your actual Moosend API key
const API_KEY = '4b186e4e-51f6-4c94-b904-b867b76050b2';

// Moosend API endpoint for sending transactional emails
const MOOSEND_API_URL = 'https://api.moosend.com/v3/email/send.json';

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Route to send email
app.post('/send-email', async (req, res) => {
  const { to, fromEmail, fromName, subject, htmlBody } = req.body;

  // Validate input
  if (!to || !fromEmail || !subject || !htmlBody) {
    return res.status(400).json({ error: 'All fields (to, fromEmail, subject, htmlBody) are required.' });
  }

  try {
    // Make API call to Moosend
    const response = await axios.post(MOOSEND_API_URL, {
      apiKey: API_KEY,
      to,
      fromEmail,
      fromName: fromName || '', // Optional
      subject,
      htmlBody,
    });

    // Return success response
    res.status(200).json({ message: 'Email sent successfully!', data: response.data });
  } catch (error) {
    // Handle errors
    console.error('Error sending email:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Failed to send email', details: error.response ? error.response.data : error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
