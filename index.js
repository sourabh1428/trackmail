const express = require('express');
const nodemailer = require('nodemailer');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

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
  
  if (fromEmail === "khushibanchhor21@gmail.com") {
    const trackingPixel = `<img src="https://discord-message.khushibanchhor21.workers.dev/track-open?email=${encodedEmail}" width="1" height="1" style="position:absolute;left:-9999px;" alt="Email Open Tracking" />`;
    const trackedHtml = html.replace(/<a\s+href="([^"]+)"/g, (match, url) => {
      const trackingURL = `https://discord-message.khushibanchhor21.workers.dev/track-link?email=${encodedEmail}&url=${encodeURIComponent(url)}`;
      return match.replace(url, trackingURL);
    });
    return trackedHtml + trackingPixel;
  }

  const trackingPixel = `<img src="https://test-open.sppathak1428.workers.dev/track-open?email=${encodedEmail}" width="1" height="1" style="position:absolute;left:-9999px;" alt="Email Open Tracking" />`;
  const trackedHtml = html.replace(/<a\s+href="([^"]+)"/g, (match, url) => {
    const trackingURL = `https://test-open.sppathak1428.workers.dev/track-link?email=${encodedEmail}&url=${encodeURIComponent(url)}`;
    return match.replace(url, trackingURL);
  });
  return trackedHtml + trackingPixel;
}

function createTransporter(fromEmail) {
  const config = {
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    pool: true,
    encoding: "utf-8",
    maxConnections: 10,
    rateDelta: 1000,
    rateLimit: 5,
  };

  if (fromEmail === "khushibanchhor21@gmail.com") {
    return nodemailer.createTransport({
      ...config,
      auth: {
        user: process.env.EMAIL_USER_2,
        pass: process.env.EMAIL_PASS_2,
      },
    });
  }

  return nodemailer.createTransport({
    ...config,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

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

    const users = await db.collection("Users").find({ 
      bunchID: recipientData.bunchID 
    }).toArray();

    const uniqueEmails = [...new Set(users.filter(user => user.email).map(user => user.email))];
    console.log(`Found ${uniqueEmails.length} unique email addresses.`);

    const transporter = createTransporter(from);
    const emailTemplate = getEmailTemplate(from);

    const emailPromises = uniqueEmails.map(async (email) => {
      let alreadySent;
      
      if(email!=="sppathak1428@gmail.com" || email!=="khushibanchhor21@gmail.com") {
        alreadySent = await db.collection("AlreadySent").findOne({ email });
      }
      if (alreadySent) return null;

      try {
        const trackedHtml = addEmailTracking(emailTemplate, email, from);

        await transporter.sendMail({
          from,
          to: email,
          subject,
          html: trackedHtml,
        });
      
        if(email!=="sppathak1428@gmail.com" && email!=="khushibanchhor21@gmail.com") {
          await db.collection("AlreadySent").insertOne({ email });
        }
        console.log(`Email sent to ${email}`);
        return email;
      } catch (error) {
        console.error(`Error sending email to ${email}:`, error);
        return null;
      }
    });

    const results = await Promise.allSettled(emailPromises);
    
    const successfulEmails = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
    const failedEmails = results.filter(r => r.status === 'rejected' || r.value === null).length;
    
    console.log(`Bulk email process completed. 
      Successful emails: ${successfulEmails}, 
      Failed emails: ${failedEmails}`);

  } catch (error) {
    console.error("Error during bulk email process:", error);
  } finally {
    if (db) await client.close();
  }
}

app.post('/send-bulk-emails', async (req, res) => {
  const { from, subject, recipientType, recipientData } = req.body;

  if (!from || !subject || !recipientType || !recipientData) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  try {
    sendBulkEmails(from, subject, recipientType, recipientData);
    res.status(200).json({ message: "Bulk email process initiated." });
  } catch (error) {
    console.error("Error in bulk email API:", error);
    res.status(500).json({ message: "Failed to initiate bulk email process.", error });
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

    res.status(200).json({ message: "Email sent successfully!" });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({ message: "Failed to send email", error });
  }
});

app.post('/sourabh-send', async (req, res) => {
  try {
    const data = await sendBulkEmails(
      "sppathak1428@gmail.com", 
      "Application for SDE-1", 
      "bunch", 
      {"bunchID":"test"}
    );
    if(data) {
      console.log("All emails are sent successfully");
    }
    res.status(200).json({ message: "Bulk email process initiated." });
  } catch(error) {
    console.error("Error in bulk email API:", error);
    res.status(500).json({ message: "Failed to initiate bulk email process.", error });
  }
});

app.post('/khushi-send', async (req, res) => {
  try {
    const data = await sendBulkEmails(
      "khushibanchhor21@gmail.com", 
      "Application for SDE-1", 
      "bunch", 
      {"bunchID":"test"}
    );
    if(data) {
      console.log("All emails are sent successfully");
    }
    res.status(200).json({ message: "Bulk email process initiated." });
  } catch(error) {
    console.error("Error in bulk email API:", error);
    res.status(500).json({ message: "Failed to initiate bulk email process.", error });
  }
});

app.post('/send', async (req, res) => {
  const { from, subject, recipientType, recipientData } = req.body;

  if (!from || !subject || !recipientType || !recipientData) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  try {
    sendBulkEmails(from, subject, recipientType, recipientData);
    res.status(200).json({ message: "Bulk email process initiated." });
  } catch (error) {
    console.error("Error in bulk email API:", error);
    res.status(500).json({ message: "Failed to initiate bulk email process.", error });
  }
});

process.on('SIGINT', async () => {
  console.log('Closing database connection...');
  await client.close();
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});