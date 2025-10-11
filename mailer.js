"use strict";

const nodemailer = require("nodemailer");

const {
	EMAIL_USER,
	EMAIL_PASS,
} = process.env;

if (!EMAIL_USER || !EMAIL_PASS) {
	console.warn("[mailer] EMAIL_USER/EMAIL_PASS not set. Emails will fail until provided.");
}

// Create a single reusable transporter for the app lifecycle
const transporter = nodemailer.createTransport({
	host: "smtp.gmail.com",
	port: 465,
	secure: true,
	auth: {
		user: EMAIL_USER,
		pass: EMAIL_PASS,
	},
});

/**
 * Send an email using the shared transporter.
 * @param {Object} options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} [options.text] - Plain text body
 * @param {string} [options.html] - HTML body
 * @param {Array} [options.attachments] - Nodemailer attachments
 * @returns {Promise<object>} Nodemailer response
 */
async function sendEmail({ to, subject, text, html, attachments }) {
	if (!to) throw new Error("'to' is required");
	if (!subject) throw new Error("'subject' is required");

	const info = await transporter.sendMail({
		from: EMAIL_USER,
		to,
		subject,
		text,
		html,
		attachments,
	});
	return info;
}

module.exports = {
	transporter,
	sendEmail,
};
