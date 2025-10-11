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
const defaultTemplatePath = path.join(__dirname, './test.html');

function getEmailTemplate(fromEmail) {
  return fs.readFileSync(defaultTemplatePath, 'utf8').replace(/\r?\n|\r/g, '');
}

function personalizeEmailTemplate(html, recipientData = {}) {
  // Default values for personalization fields
  const defaults = {
    Name: recipientData.name || 'there',
    Company: recipientData.company || 'your company',
    Role: recipientData.role || 'SDE-1',
    CalendlyLink: recipientData.calendlyLink || 'https://calendar.google.com/calendar/u/0',
    ResumeLink: recipientData.resumeLink || 'https://drive.google.com/file/d/1HgU4xXj6utzQQ3OtW9xyLcXGnTYfHvrR/view?usp=sharing',
    YourEmail: recipientData.yourEmail || 'sppathak1428@gmail.com'
  };

  // Replace all personalization fields with their values
  let personalizedHtml = html;
  Object.keys(defaults).forEach(key => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    personalizedHtml = personalizedHtml.replace(regex, defaults[key]);
  });

  return personalizedHtml;
}

function addEmailTracking(html, email, fromEmail) {
  const encodedEmail = encodeURIComponent(email);
  
  const trackingBaseUrl = "https://test-open.sppathak1428.workers.dev";
  
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

function createTransport(fromEmail) {
  const config = {
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    pool: true,
    maxConnections: 1,
    rateLimit: 20,
    rateDelta: 60000,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
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
    db = client.db("Linkedin_scrape");

    // Create index WITHOUT expiry - emails will be permanently tracked
    try {
      await db.collection("AlreadySent").createIndex({ email: 1 }, { unique: true });
    } catch (indexError) {
      // Index might already exist, that's fine
      console.log("Index already exists or creation failed:", indexError.message);
    }

    // Validate recipient type
    if (recipientType !== "bunch") {
      console.log("Recipient type is not 'bunch'. Skipping email sending.");
      return { Success: 0, Failed: 0 };
    }

    // Validate recipientData
    if (!recipientData || !recipientData.bunchID) {
      throw new Error("BunchID is required in recipientData");
    }

    // Get all users from the specified bunch
    const users = await db.collection("Emails").find({ bunch_id: recipientData.bunchID }).toArray();
    console.log(`Found ${users.length} users in bunch: ${recipientData.bunchID}`);

    // Extract unique emails and filter out invalid ones
    const uniqueEmails = [...new Set(
      users
        .map(user => user.email)
        .filter(email => email && email.includes('@')) // Basic email validation
    )];
    console.log(`Found ${uniqueEmails.length} unique valid emails.`);

    if (uniqueEmails.length === 0) {
      console.log("No valid emails found in the bunch.");
      return { Success: 0, Failed: 0 };
    }

    // Check which emails have already been sent
    const alreadySentEmails = await db.collection("AlreadySent")
      .find({ email: { $in: uniqueEmails } })
      .project({ email: 1 })
      .toArray();
    
    const alreadySentSet = new Set(alreadySentEmails.map(doc => doc.email));
    console.log(`${alreadySentSet.size} emails have already been sent previously.`);

    // Filter emails to send (always include test email for debugging)
    const emailsToSend = uniqueEmails.filter(email => 
      email === "sppathak1428@gmail.com" || !alreadySentSet.has(email)
    );

    console.log(`${emailsToSend.length} emails will be sent.`);

    if (emailsToSend.length === 0) {
      console.log("No new emails to send after filtering.");
      return { Success: 0, Failed: 0 };
    }

    // Create transporter and get email template
    transporter = createTransport(from);
    const emailTemplate = getEmailTemplate(from);
    
    const MAX_RETRIES = 3;
    let successCount = 0;
    let failureCount = 0;

    // Send emails with retry logic
    for (const email of emailsToSend) {
      let retries = 0;
      
      while (retries < MAX_RETRIES) {
        try {
          // Find user data for personalization
          const userData = users.find(user => user.email === email) || {};
          
          // Merge user data with recipientData for personalization
          const personalizationData = {
            ...recipientData,
            name: userData.name || userData.fullName || recipientData.name,
            company: userData.company || recipientData.company,
            role: userData.role || userData.title || recipientData.role
          };

          // Personalize and add tracking
          const personalizedHtml = personalizeEmailTemplate(emailTemplate, personalizationData);
          const trackedHtml = addEmailTracking(personalizedHtml, email, from);

          // Send email
          await transporter.sendMail({
            from,
            to: email,
            subject,
            html: trackedHtml
          });

          // Mark as sent (except for test email)
          if (email !== "sppathak1428@gmail.com") {
            try {
              await db.collection("AlreadySent").insertOne({ 
                email, 
                sentAt: new Date(),
                bunchID: recipientData.bunchID,
                subject: subject
              });
            } catch (insertError) {
              // Handle duplicate key error (email already exists)
              if (insertError.code !== 11000) {
                console.error(`Error marking email as sent for ${email}:`, insertError.message);
              }
            }
          }

          successCount++;
          console.log(`✅ Successfully sent to ${email}`);
          break; // Success, exit retry loop

        } catch (error) {
          retries++;
          console.error(`❌ Error sending to ${email} (Attempt ${retries}/${MAX_RETRIES}):`, error.message);
          
          if (retries === MAX_RETRIES) {
            failureCount++;
            console.error(`🚫 Failed permanently after ${MAX_RETRIES} attempts for ${email}`);
          } else {
            // Exponential backoff: wait longer between retries
            const delay = 5000 * Math.pow(2, retries - 1);
            console.log(`⏳ Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      // Add small delay between emails to avoid rate limiting
      if (emailsToSend.indexOf(email) < emailsToSend.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`📊 Email sending completed: ${successCount} successful, ${failureCount} failed.`);
    return { Success: successCount, Failed: failureCount };

  } catch (error) {
    console.error("💥 Bulk email process error:", error);
    throw error;
  } finally {
    // Clean up resources
    if (transporter) {
      transporter.close();
    }
    await client.close();
  }
}

// Sleep utility function for adding delays
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
    const transporter = createTransport(from);
    const emailTemplate = getEmailTemplate(from);
    
    // Personalize the email template
    const personalizedHtml = personalizeEmailTemplate(emailTemplate, req.body);
    const trackedHtml = addEmailTracking(personalizedHtml, to, from);

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
      {"bunchID":"sourabh_test_2"}
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

// Get list of emails that have already been sent
app.get('/already-sent', async (req, res) => {
  try {
    await client.connect();
    const db = client.db("Linkedin_scrape");
    
    const alreadySent = await db.collection("AlreadySent").find({}).toArray();
    
    res.status(200).json({ 
      count: alreadySent.length,
      emails: alreadySent 
    });
  } catch (error) {
    console.error("Error fetching already sent emails:", error);
    res.status(500).json({ error: error.message });
  } finally {
    await client.close();
  }
});

// Clear already sent list (use with caution!)
app.delete('/clear-already-sent', async (req, res) => {
  try {
    await client.connect();
    const db = client.db("Linkedin_scrape");
    
    const result = await db.collection("AlreadySent").deleteMany({});
    
    res.status(200).json({ 
      message: `Cleared ${result.deletedCount} records from AlreadySent collection`
    });
  } catch (error) {
    console.error("Error clearing already sent emails:", error);
    res.status(500).json({ error: error.message });
  } finally {
    await client.close();
  }
});

// Test endpoint to see what the tracking HTML looks like
app.get('/test-tracking', (req, res) => {
  try {
    const template = getEmailTemplate("sppathak1428@gmail.com");
    const personalizedHtml = personalizeEmailTemplate(template, {});
    const trackedHtml = addEmailTracking(personalizedHtml, "test@example.com", "sppathak1428@gmail.com");
    res.send(trackedHtml);
  } catch (error) {
    console.error("Error testing tracking:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint to see personalized email template
app.post('/test-personalization', (req, res) => {
  try {
    const template = getEmailTemplate("sppathak1428@gmail.com");
    const personalizedHtml = personalizeEmailTemplate(template, req.body);
    res.send(personalizedHtml);
  } catch (error) {
    console.error("Error testing personalization:", error);
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