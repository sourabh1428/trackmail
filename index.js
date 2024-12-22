const express = require('express');
const nodemailer = require('nodemailer');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

// Load email template
const emailTemplatePath = path.join(__dirname, './test.html');
const emailHTMLTemplate = fs.readFileSync(emailTemplatePath, 'utf8').replace(/\r?\n|\r/g, '');


// MongoDB client setup
const client = new MongoClient(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Nodemailer transporter setup
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  pool: true,
  encoding: "utf-8", // Ensure proper encoding
  maxConnections: 10,
  rateDelta: 1000,
  rateLimit: 5,
});

// Add tracking to email content
function addEmailTracking(html, email) {
  const encodedEmail = encodeURIComponent((email));
  
  // Tracking pixel
  const trackingPixel = `<img src="https://test-open.sppathak1428.workers.dev/track-open?email=${encodedEmail}" width="1" height="1" style="position:absolute;left:-9999px;" alt="Email Open Tracking" />`;
  
  // Add tracking to links
  const trackedHtml = html.replace(/<a\s+href="([^"]+)"/g, (match, url) => {
    const trackingURL = `https://test-open.sppathak1428.workers.dev/track-link?email=${encodedEmail}&url=${encodeURIComponent(url)}`;
    return match.replace(url, trackingURL);
  });

  return trackedHtml + trackingPixel;
}

// Bulk email sending function
async function sendBulkEmails(from, subject, recipientType, recipientData) {
  console.log("Starting bulk email process...");
  
  let db;
  try {
    await client.connect();
    db = client.db("test_db");
    
    if (recipientType !== "bunch") {
      console.log("Recipient type is not 'bunch'. Skipping email sending.");
      return;
    }

    // Find unique emails for the bunch
    const users = await db.collection("Users").find({ 
      bunchID: recipientData.bunchID 
    }).toArray();

    const uniqueEmails = [...new Set(users.filter(user => user.email).map(user => user.email))];
    console.log(`Found ${uniqueEmails.length} unique email addresses.`);

    // Create a queue of email promises
    const emailPromises = uniqueEmails.map(async (email) => {
      // Check if email has already been sent
      const alreadySent = await db.collection("AlreadySent").findOne({ email });
      if (alreadySent) return null;

      try {
        // Add tracking to the email template
        const trackedHtml = addEmailTracking(emailHTMLTemplate, email);

        // Send email
        await transporter.sendMail({
          from,
          to: email,
          subject,
          html: trackedHtml,
        });

        // Record as sent
      
        await db.collection("AlreadySent").insertOne({ email });
        console.log(`Email sent to ${email}`);
        return email;
      } catch (error) {
        console.error(`Error sending email to ${email}:`, error);
        return null;
      }
    });

    // Process all email promises
    const results = await Promise.allSettled(emailPromises);
    
    // Log summary
    const successfulEmails = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
    const failedEmails = results.filter(r => r.status === 'rejected' || r.value === null).length;
    
    console.log(`Bulk email process completed. 
      Successful emails: ${successfulEmails}, 
      Failed emails: ${failedEmails}`);

  } catch (error) {
    console.error("Error during bulk email process:", error);
  } finally {
    // Ensure connection is closed
    if (db) await client.close();
  }
}

// Bulk email API endpoint
app.post('/send-bulk-emails', async (req, res) => {
  const { from, subject, recipientType, recipientData } = req.body;

  if (!from || !subject || !recipientType || !recipientData) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  try {
    // Start the bulk email process without blocking the response
    sendBulkEmails(from, subject, recipientType, recipientData);
    
    // Immediately respond to the client
    res.status(200).json({ message: "Bulk email process initiated." });
  } catch (error) {
    console.error("Error in bulk email API:", error);
    res.status(500).json({ message: "Failed to initiate bulk email process.", error });
  }
});

// Single email sending endpoint
app.post('/send-email', async (req, res) => {
  const { from, to, subject, replyTo } = req.body;

  if (!to) {
    return res.status(400).json({ message: "Recipient email (to) is required." });
  }

  try {
    // Add tracking to the email template
    const trackedHtml = addEmailTracking(emailHTMLTemplate, to);

    // Send email
    await transporter.sendMail({
      from,
      to,
      subject,
      html: trackedHtml,
      replyTo: replyTo || from,
    });

    res.status(200).json({ message: "Email sent successfully!" });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({ message: "Failed to send email", error });
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Closing database connection...');
  await client.close();
  process.exit(0);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});