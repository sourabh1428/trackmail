const express = require('express');
const nodemailer = require('nodemailer');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const axios = require('axios');

const app = express();
app.use(express.json());

// MongoDB client setup
const client = new MongoClient(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Load email templates
const defaultTemplatePath = path.join(__dirname, './test_2.html');
const khushiTemplatePath = path.join(__dirname, './test_khushi.html');

function getEmailTemplate(fromEmail) {
  if (fromEmail === "khushibanchhor21@gmail.com") {
    return fs.readFileSync(khushiTemplatePath, 'utf8').replace(/\r?\n|\r/g, '');
  }
  return fs.readFileSync(defaultTemplatePath, 'utf8').replace(/\r?\n|\r/g, '');
}

function addEmailTracking(html, email, fromEmail) {
  const encodedEmail = encodeURIComponent(email);
  
  let trackingBaseUrl;
  if (fromEmail === "khushibanchhor21@gmail.com") {
    trackingBaseUrl = "https://discord-message.khushibanchhor21.workers.dev";
  } else {
    trackingBaseUrl = "https://test-open.sppathak1428.workers.dev";
  }
  
  const trackingPixel = `<img src="${trackingBaseUrl}/track-open?email=${encodedEmail}" width="1" height="1" style="position:absolute;left:-9999px;" alt="" />`;
  
  let trackedHtml = html.replace(/<a\s+(?:[^>]*?\s+)?href=(['"])(.*?)\1/gi, (match, quote, url) => {
    if (url.includes('/track-link') || url.startsWith('#') || url.startsWith('mailto:')) {
      return match;
    }
    const trackingURL = `${trackingBaseUrl}/track-link?email=${encodedEmail}&url=${encodeURIComponent(url)}`;
    return `<a href=${quote}${trackingURL}${quote}`;
  });

  return trackedHtml.includes('</body>') 
    ? trackedHtml.replace('</body>', `${trackingPixel}</body>`)
    : trackedHtml + trackingPixel;
}

function createTransporter(fromEmail) {
  const config = {
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    pool: true,
    maxConnections: 1,
    rateLimit: 20,
    rateDelta: 60000,
    auth: {
      user: fromEmail === "khushibanchhor21@gmail.com" ? process.env.EMAIL_USER_2 : process.env.EMAIL_USER,
      pass: fromEmail === "khushibanchhor21@gmail.com" ? process.env.EMAIL_PASS_2 : process.env.EMAIL_PASS,
    },
    tls: { rejectUnauthorized: false }
  };

  return nodemailer.createTransport(config);
}

async function sendBulkEmails(from, subject, recipientType, recipientData) {
  console.log("Starting bulk email process...");
  let db, transporter;
  try {
    await client.connect();
    db = client.db("test_db");

    // Ensure TTL Index
    await db.collection("AlreadySent").createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 864000 }
    );

    if (recipientType !== "bunch") {
      console.log("Recipient type is not 'bunch'. Skipping email sending.");
      return { Success: 0, Failed: 0 };
    }

    const users = await db.collection("Users").find({ bunchID: recipientData.bunchID }).toArray();
    const uniqueEmails = [...new Set(users.map(user => user.email).filter(Boolean))];
    console.log(`Found ${uniqueEmails.length} unique emails.`);

    const alreadySentEmails = await db.collection("AlreadySent")
      .find({ email: { $in: uniqueEmails } })
      .project({ email: 1 })
      .toArray();
    const alreadySentSet = new Set(alreadySentEmails.map(doc => doc.email));

    const emailsToSend = uniqueEmails.filter(email => 
      ["sppathak1428@gmail.com", "khushibanchhor21@gmail.com"].includes(email) || 
      !alreadySentSet.has(email)
    );

    if (emailsToSend.length === 0) {
      console.log("No emails to send after filtering.");
      return { Success: 0, Failed: 0 };
    }

    transporter = createTransporter(from);
    const emailTemplate = getEmailTemplate(from);
    const MAX_RETRIES = 3;
    let successCount = 0, failureCount = 0;

    for (const email of emailsToSend) {
      let retries = 0;
      while (retries < MAX_RETRIES) {
        try {
          const trackedHtml = addEmailTracking(emailTemplate, email, from);
          await transporter.sendMail({
            from,
            to: email,
            subject,
            html: trackedHtml
          });

          if (!["sppathak1428@gmail.com", "khushibanchhor21@gmail.com"].includes(email)) {
            await db.collection("AlreadySent").insertOne({ email, createdAt: new Date() });
          }

          successCount++;
          console.log(`Sent to ${email}`);
          break;
        } catch (error) {
          retries++;
          console.error(`Error sending to ${email} (Attempt ${retries}): ${error.message}`);
          if (retries === MAX_RETRIES) {
            failureCount++;
            console.error(`Failed after ${MAX_RETRIES} attempts for ${email}`);
          } else {
            await new Promise(resolve => setTimeout(resolve, 5000 * retries));
          }
        }
      }
    }

    console.log(`Processed ${successCount} emails successfully, ${failureCount} failed.`);
    return { Success: successCount, Failed: failureCount };

  } catch (error) {
    console.error("Bulk email error:", error);
    throw error;
  } finally {
    if (transporter) transporter.close();
    await client.close();
  }
}

// Sleep utility function for adding delays
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Process emails in batches with smart retry logic

app.post('/send-bulk-emails', async (req, res) => {
  const { from, subject, recipientType, recipientData } = req.body;

  if (!from || !subject || !recipientType || !recipientData) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  try {
    const result = await sendBulkEmails(from, subject, recipientType, recipientData);
    res.status(200).json({ 
      message: "Bulk email process completed.", 
      stats: {
        successful: result.Success,
        failed: result.Failed
      }
    });
  } catch (error) {
    console.error("Error in bulk email API:", error);
    res.status(500).json({ message: "Failed to complete bulk email process.", error: error.message });
  }
});

app.post('/send-email', async (req, res) => {
  const { from, to, subject, replyTo } = req.body;

  if (!to) {
    return res.status(400).json({ message: "Recipient email (to) is required." });
  }

  try {
    const transporter = createTransporter(from);
    const emailTemplate = getEmailTemplate(from);
    const trackedHtml = addEmailTracking(emailTemplate, to, from);

    await transporter.sendMail({
      from,
      to,
      subject,
      html: trackedHtml,
      replyTo: replyTo || from,
    });

    transporter.close();
    res.status(200).json({ message: "Email sent successfully!" });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({ message: "Failed to send email", error: error.message });
  }
});

app.get('/sourabh-send', async (req, res) => {
  try {
    const data = await sendBulkEmails(
      "sppathak1428@gmail.com", 
      "Application for SDE-1", 
      "bunch", 
      {"bunchID":"sourabh_test_1"}
    );
    
    if(data) {
      console.log("Bulk email process completed");
    }
    res.status(200).json({ message: data });
  } catch(error) {
    console.error("Error in bulk email API:", error);
    res.status(500).json({ message: "Failed to initiate bulk email process.", error: error.message });
  }
});

// Helper function for Discord notifications
function getFormattedDate() {
  const today = new Date();
  return today.toLocaleDateString('en-GB'); // Format: DD/MM/YYYY
}

async function sendToDiscordWithRetry(webhookURL, message, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(webhookURL, message, {
        headers: { 'Content-Type': 'application/json' },
      });
      console.log("Data sent to Discord:", response.status);
      return response;
    } catch (error) {
      if (error.response?.status === 429) {
        const retryAfter = parseInt(error.response.headers['retry-after'], 10) || 1; // Wait time in seconds
        console.warn(`Rate limited. Retrying in ${retryAfter} seconds... (Attempt ${attempt})`);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000)); // Wait and retry
      } else {
        console.error(`Error on attempt ${attempt}:`, error.message);
        if (attempt === maxRetries) {
          throw new Error("Failed to send message to Discord after multiple retries.");
        }
      }
    }
  }
}

app.get('/khushi-send', async (req, res) => {
  try {
    const emailData = await sendBulkEmails(
      "khushibanchhor21@gmail.com",
      "Application for SDE-1",
      "bunch",
      { "bunchID": "linkedin_test_7" }
    );

    if (emailData) {
      console.log("Bulk email process completed");

      // Discord webhook URL
      const discordWebhookURL = 'https://discord.com/api/webhooks/1326613830620418049/6EAfBWS7BvB0_GTJFtka4geBpW8EgvnpKoA2vDz0bp8ozHeFHupWRJT5KTGZoXC6ue-V';

      // Prepare Discord message
      const discordMessage = {
        content: `Bulk Email Report - ${getFormattedDate()}`,
        embeds: [
          {
            title: "Bulk Email Status",
            description: "Summary of today's email delivery.",
            fields: [
              { name: "Sender", value: "khushibanchhor21@gmail.com", inline: true },
              { name: "Success", value: String(emailData.Success || "0"), inline: true },
              { name: "Failed", value: String(emailData.Failed || "0"), inline: true },
            ],
            color: 3066993, // Green color
            timestamp: new Date().toISOString()
          },
        ],
      };

      // Send data to Discord using the retry logic
      await sendToDiscordWithRetry(discordWebhookURL, discordMessage);
    }

    res.status(200).json({ message: emailData });
  } catch (error) {
    console.error("Error in bulk email API:", error.message);
    res.status(500).json({ message: "Failed to initiate bulk email process.", error: error.message });
  }
});

app.post('/send', async (req, res) => {
  const { from, subject, recipientType, recipientData } = req.body;

  if (!from || !subject || !recipientType || !recipientData) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  try {
    const result = await sendBulkEmails(from, subject, recipientType, recipientData);
    res.status(200).json({ 
      message: "Bulk email process completed.", 
      result 
    });
  } catch (error) {
    console.error("Error in bulk email API:", error);
    res.status(500).json({ message: "Failed to initiate bulk email process.", error: error.message });
  }
});

// Test endpoint to see what the tracking HTML looks like
app.get('/test-tracking', (req, res) => {
  try {
    const template = getEmailTemplate("sppathak1428@gmail.com");
    const trackedHtml = addEmailTracking(template, "test@example.com", "sppathak1428@gmail.com");
    res.send(trackedHtml);
  } catch (error) {
    console.error("Error testing tracking:", error);
    res.status(500).json({ error: error.message });
  }
});

// Simple health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'up', timestamp: new Date().toISOString() });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Closing database connection...');
  await client.close();
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});