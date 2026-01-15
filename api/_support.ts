// @ts-nocheck
// ============================================================
// API/_SUPPORT.JS - Support Tickets & Email Service
// ============================================================

import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import {
  applyCors,
  validateSessionAndFetchPlayerStats,
  getIdentifier,
  checkRateLimit
} from './_utils.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================================
// NODEMAILER CONFIGURATION
// ============================================================

// Debug: Log environment variables (safely)
console.log('📧 Email Config:');
console.log('  GMAIL_USER:', process.env.GMAIL_USER ? '✅ SET' : '❌ NOT SET');
console.log('  GMAIL_APP_PASSWORD:', process.env.GMAIL_APP_PASSWORD ? '✅ SET' : '❌ NOT SET');
console.log('  SUPABASE_URL:', process.env.SUPABASE_URL ? '✅ SET' : '❌ NOT SET');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.GMAIL_USER || 'lootskirmish.official@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD || ''
  },
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  rateDelta: 1000,
  rateLimit: 5,
  connectionUrl: undefined
});

// Verify connection on startup (async to avoid blocking)
setTimeout(() => {
  transporter.verify((error, success) => {
    if (error) {
      console.error('❌ SMTP connection error at startup:', error.message);
      console.error('   Code:', error.code);
    } else {
      console.log('✅ SMTP server ready to send emails');
    }
  });
}, 1000);

// ============================================================
// CONSTANTS
// ============================================================

const DAILY_EMAIL_LIMIT = 450;
const MAX_RETRY_ATTEMPTS = 3;
const SUPPORT_RATE_LIMIT_MAX = 3;
const SUPPORT_RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const supportRateLimits = new Map();

// ============================================================
// EMAIL HTML TEMPLATE
// ============================================================

function generateSupportEmailTemplate({ ticketId, userName, userEmail, subject, message }) {
  return `
<!DOCTYPE html>
<html lang="en-US">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LootSkirmish Support #${ticketId}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0f172a; color: #e2e8f0;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #1e293b; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); padding: 32px 24px; text-align: center;">
      <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #ffffff; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);">
        🎮 LootSkirmish Support
      </h1>
      <p style="margin: 8px 0 0; font-size: 14px; color: #e9d5ff; font-weight: 500;">
        Ticket #${ticketId}
      </p>
    </div>

    <!-- Content -->
    <div style="padding: 32px 24px;">
      
      <!-- Ticket Info -->
      <div style="background-color: #334155; border-left: 4px solid #8b5cf6; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
        <h2 style="margin: 0 0 12px; font-size: 18px; color: #f1f5f9;">
          📋 Ticket Information
        </h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #94a3b8; font-size: 14px; width: 100px;">Name:</td>
            <td style="padding: 8px 0; color: #e2e8f0; font-size: 14px; font-weight: 500;">${userName}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #94a3b8; font-size: 14px;">Email:</td>
            <td style="padding: 8px 0; color: #e2e8f0; font-size: 14px; font-weight: 500;">${userEmail}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #94a3b8; font-size: 14px;">Subject:</td>
            <td style="padding: 8px 0; color: #e2e8f0; font-size: 14px; font-weight: 500;">${subject}</td>
          </tr>
        </table>
      </div>

      <!-- Message -->
      <div style="background-color: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
        <h3 style="margin: 0 0 12px; font-size: 16px; color: #f1f5f9; display: flex; align-items: center;">
          💬 Message
        </h3>
        <div style="color: #cbd5e1; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word;">
${message}
        </div>
      </div>

      <!-- Reply Info -->
      <div style="background-color: #0f172a; border-radius: 8px; padding: 16px; border: 1px solid #334155;">
        <p style="margin: 0; font-size: 13px; color: #94a3b8; line-height: 1.5;">
          ℹ️ <strong style="color: #e2e8f0;">To reply:</strong> Use the email <strong style="color: #8b5cf6;">${userEmail}</strong> and include the ticket ID <strong style="color: #8b5cf6;">#${ticketId}</strong> in the subject.
        </p>
      </div>

    </div>

    <!-- Footer -->
    <div style="background-color: #0f172a; padding: 20px 24px; text-align: center; border-top: 1px solid #334155;">
      <p style="margin: 0; font-size: 12px; color: #64748b;">
        © ${new Date().getFullYear()} LootSkirmish. Automatic support system.
      </p>
      <p style="margin: 8px 0 0; font-size: 11px; color: #475569;">
        Ticket received at ${new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })}
      </p>
    </div>

  </div>
</body>
</html>
  `;
}

// ============================================================
// DAILY COUNTER MANAGEMENT
// ============================================================

async function getEmailCounter() {
  try {
    const { data, error } = await supabase.rpc('get_email_counter');
    
    if (error) {
      console.error('❌ Error getting email counter:', error);
      return { count: 0, lastReset: new Date() };
    }
    
    if (!data || data.length === 0) {
      return { count: 0, lastReset: new Date() };
    }
    
    return {
      count: data[0].count || 0,
      lastReset: new Date(data[0].last_reset)
    };
  } catch (error) {
    console.error('💥 Exception getting counter:', error);
    return { count: 0, lastReset: new Date() };
  }
}

async function incrementEmailCounter() {
  try {
    const { data, error } = await supabase.rpc('increment_email_counter');
    
    if (error) {
      console.error('❌ Error incrementing counter:', error);
      return null;
    }
    
    return data;
  } catch (error) {
    console.error('💥 Exception incrementing counter:', error);
    return null;
  }
}

async function resetEmailCounter() {
  try {
    const { error } = await supabase.rpc('reset_email_counter');
    
    if (error) {
      console.error('❌ Error resetting counter:', error);
      return false;
    }
    
    console.log('✅ Email counter reset successfully');
    return true;
  } catch (error) {
    console.error('💥 Exception resetting counter:', error);
    return false;
  }
}

// ============================================================
// QUEUE MANAGEMENT
// ============================================================

async function addToQueue({ tipo, destinatario, assunto, mensagem }) {
  try {
    const { data, error } = await supabase
      .from('email_queue')
      .insert({
        tipo,
        destinatario,
        assunto,
        mensagem,
        status: 'pendente',
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      console.error('❌ Error adding to queue:', error);
      return null;
    }
    
    console.log(`📥 Email added to queue (ID: ${data.id})`);
    return data;
  } catch (error) {
    console.error('💥 Exception adding to queue:', error);
    return null;
  }
}

async function getPendingEmails(limit = 450) {
  try {
    const { data, error } = await supabase
      .from('email_queue')
      .select('*')
      .eq('status', 'pendente')
      .order('created_at', { ascending: true })
      .limit(limit);
    
    if (error) {
      console.error('❌ Error getting pending emails:', error);
      return [];
    }
    
    return data || [];
  } catch (error) {
    console.error('💥 Exception getting pending emails:', error);
    return [];
  }
}

async function updateEmailStatus(emailId, status, errorMessage = null) {
  try {
    const updateData = {
      status,
      sent_at: status === 'enviado' ? new Date().toISOString() : null
    };
    
    if (errorMessage) {
      updateData.error_message = errorMessage;
    }
    
    const { error } = await supabase
      .from('email_queue')
      .update(updateData)
      .eq('id', emailId);
    
    if (error) {
      console.error('❌ Error updating email status:', error);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('💥 Exception updating status:', error);
    return false;
  }
}

async function incrementRetryCount(emailId) {
  try {
    const { error } = await supabase.rpc('increment', {
      row_id: emailId,
      x: 1,
      table_name: 'email_queue',
      column_name: 'retry_count'
    });
    
    if (error) {
      const { data: current } = await supabase
        .from('email_queue')
        .select('retry_count')
        .eq('id', emailId)
        .single();
      
      await supabase
        .from('email_queue')
        .update({ retry_count: (current?.retry_count || 0) + 1 })
        .eq('id', emailId);
    }
    
    return true;
  } catch (error) {
    console.error('💥 Exception incrementing retry:', error);
    return false;
  }
}

// ============================================================
// EMAIL SENDING
// ============================================================

async function sendEmail({ to, subject, html, fromName = 'LootSkirmish Support' }) {
  try {
    // Check if credentials exist
    const gmailUser = process.env.GMAIL_USER || 'lootskirmish.official@gmail.com';
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    
    if (!gmailPass) {
      console.error('❌ GMAIL_APP_PASSWORD is not set in environment!');
      return { 
        success: false, 
        error: 'Email service not properly configured',
        code: 'CONFIG_ERROR'
      };
    }
    
    const mailOptions = {
      from: `"${fromName}" <${gmailUser}>`,
      to,
      subject,
      html,
      priority: 'high'
    };
    
    console.log(`📧 Sending email from: ${gmailUser} to: ${to}`);
    
    const info = await transporter.sendMail(mailOptions);
    
    console.log(`✅ Email sent successfully: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
    
  } catch (error) {
    console.error('❌ Error sending email:', error.message);
    console.error('   Code:', error.code);
    console.error('   Command:', error.command);
    return { 
      success: false, 
      error: error.message,
      code: error.code 
    };
  }
}

// ============================================================
// SEND OR QUEUE - MAIN FUNCTION
// ============================================================

// Save ticket to database (keep UUID id auto-generated, store our human code in ticket_code)
async function saveSupportTicketToDatabase(ticketId, userId, userEmail, subject, message) {
  try {
    const { data, error } = await supabase
      .from('support_tickets')
      .insert({
        ticket_code: ticketId,
        user_id: userId,
        user_email: userEmail,
        subject: subject,
        message: message,
        status: 'pending'
      })
      .select();
    
    if (error) {
      console.error('❌ Error saving ticket to database:', error);
      return null;
    }
    
    console.log(`✅ Ticket saved to database: ${ticketId}`);
    return data ? data[0] : null;
  } catch (err) {
    console.error('💥 Exception saving ticket:', err);
    return null;
  }
}

export async function sendOrQueueSupportEmail({ 
  ticketId, 
  userId,
  userName, 
  userEmail, 
  subject, 
  message 
}) {
  try {
    const { count } = await getEmailCounter();
    
    console.log(`📊 Daily email count: ${count}/${DAILY_EMAIL_LIMIT}`);
    
    const htmlContent = generateSupportEmailTemplate({
      ticketId,
      userName,
      userEmail,
      subject,
      message
    });
    
    const emailSubject = `LootSkirmish Support #${ticketId} - ${subject}`;
    const destinatario = process.env.GMAIL_USER || 'lootskirmish.official@gmail.com';
    
    if (count < DAILY_EMAIL_LIMIT) {
      const result = await sendEmail({
        to: destinatario,
        subject: emailSubject,
        html: htmlContent
      });
      
      if (result.success) {
        await incrementEmailCounter();
        
        console.log(`✅ Support email sent immediately (Ticket #${ticketId})`);
        return {
          success: true,
          sent: 'immediately',
          ticketId,
          messageId: result.messageId
        };
      } else {
        console.warn(`⚠️ Failed to send email, adding to queue...`);
        
        const queued = await addToQueue({
          tipo: 'support',
          destinatario,
          assunto: emailSubject,
          mensagem: htmlContent
        });
        
        if (queued) {
          return {
            success: true,
            sent: 'queued_after_error',
            ticketId,
            queueId: queued.id,
            error: result.error
          };
        } else {
          throw new Error('Failed to send and failed to queue');
        }
      }
    } else {
      console.log(`⏰ Daily limit reached, adding to queue...`);
      
      const queued = await addToQueue({
        tipo: 'support',
        destinatario,
        assunto: emailSubject,
        mensagem: htmlContent
      });
      
      if (queued) {
        return {
          success: true,
          sent: 'queued',
          ticketId,
          queueId: queued.id,
          message: 'Daily limit reached, email will be sent tomorrow'
        };
      } else {
        throw new Error('Failed to add email to queue');
      }
    }
    
  } catch (error) {
    console.error('💥 Fatal error in sendOrQueueSupportEmail:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================================
// PROCESS EMAIL QUEUE
// ============================================================

export async function processEmailQueue() {
  try {
    console.log('🔄 Starting email queue processing...');
    
    await resetEmailCounter();
    
    const pendingEmails = await getPendingEmails(DAILY_EMAIL_LIMIT);
    
    if (pendingEmails.length === 0) {
      console.log('✅ No pending emails in queue');
      return { processed: 0, success: 0, failed: 0 };
    }
    
    console.log(`📧 Processing ${pendingEmails.length} pending emails...`);
    
    let successCount = 0;
    let failedCount = 0;
    
    for (const email of pendingEmails) {
      try {
        const result = await sendEmail({
          to: email.destinatario,
          subject: email.assunto,
          html: email.mensagem
        });
        
        if (result.success) {
          await updateEmailStatus(email.id, 'enviado');
          await incrementEmailCounter();
          successCount++;
          
          console.log(`✅ Email ${email.id} sent successfully`);
          
          await new Promise(resolve => setTimeout(resolve, 200));
        } else {
          await incrementRetryCount(email.id);
          
          const { data: current } = await supabase
            .from('email_queue')
            .select('retry_count')
            .eq('id', email.id)
            .single();
          
          if (current && current.retry_count >= MAX_RETRY_ATTEMPTS) {
            await updateEmailStatus(email.id, 'erro', result.error);
            failedCount++;
            console.error(`❌ Email ${email.id} failed after ${MAX_RETRY_ATTEMPTS} attempts`);
          } else {
            console.warn(`⚠️ Email ${email.id} failed, will retry later`);
          }
        }
        
      } catch (error) {
        console.error(`💥 Error processing email ${email.id}:`, error);
        failedCount++;
      }
    }
    
    console.log(`✅ Queue processing complete: ${successCount} sent, ${failedCount} failed`);
    
    return {
      processed: pendingEmails.length,
      success: successCount,
      failed: failedCount
    };
    
  } catch (error) {
    console.error('💥 Fatal error processing queue:', error);
    return { processed: 0, success: 0, failed: 0, error: error.message };
  }
}

// ============================================================
// GET QUEUE STATUS
// ============================================================

export async function getQueueStatus() {
  try {
    const { count: emailCount } = await getEmailCounter();
    
    const { count: pendingCount } = await supabase
      .from('email_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pendente');
    
    const { count: errorCount } = await supabase
      .from('email_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'erro');
    
    return {
      dailyCount: emailCount || 0,
      dailyLimit: DAILY_EMAIL_LIMIT,
      remaining: Math.max(0, DAILY_EMAIL_LIMIT - (emailCount || 0)),
      pendingEmails: pendingCount || 0,
      errorEmails: errorCount || 0
    };
  } catch (error) {
    console.error('💥 Error getting queue status:', error);
    return null;
  }
}

// ============================================================
// SUPPORT API HANDLER
// ============================================================

async function generateTicketId() {
  return `TSK-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
}

function mapResolutionToStatus(resolutionCategory) {
  const value = (resolutionCategory || '').toLowerCase();

  if (value === 'resolvable') return 'resolved';
  if (value === 'escalation') return 'escalation';
  if (value === 'spam') return 'spam';

  return 'resolved';
}

export default async function handler(req, res) {
  applyCors(req, res);
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const contentType = (req.headers?.['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return res.status(415).json({ error: 'Unsupported Media Type' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const { action } = body;

  // Support ticket submission
  if (action === 'submitTicket') {
    try {
      const { name, email, subject, message, authToken, userId } = body;

      if (!name || !email || !subject || !message) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      console.log(`🎫 New support ticket: ${name} (${email}) - ${subject}`);
      console.log(`   GMAIL_USER env: ${process.env.GMAIL_USER ? '✅ SET' : '❌ NOT SET'}`);
      console.log(`   GMAIL_APP_PASSWORD env: ${process.env.GMAIL_APP_PASSWORD ? '✅ SET' : '❌ NOT SET'}`);

      // Rate limiting by IP
      const identifier = getIdentifier(req, null);
      const allowed = checkRateLimit(supportRateLimits, identifier, {
        maxRequests: SUPPORT_RATE_LIMIT_MAX,
        windowMs: SUPPORT_RATE_LIMIT_WINDOW
      });

      if (!allowed) {
        res.setHeader('Retry-After', Math.ceil(SUPPORT_RATE_LIMIT_WINDOW / 1000));
        return res.status(429).json({ error: 'Too many support requests. Please wait before submitting another ticket.' });
      }

      // Generate ticket ID
      const ticketId = await generateTicketId();

      // Save to database
      const dbTicket = await saveSupportTicketToDatabase(ticketId, userId, email, subject, message);

      // Send or queue email
      const emailResult = await sendOrQueueSupportEmail({
        ticketId,
        userId,
        userName: name,
        userEmail: email,
        subject,
        message
      });

      if (!emailResult.success) {
        return res.status(500).json({ error: 'Failed to submit ticket' });
      }

      return res.status(200).json({
        success: true,
        ticketId,
        message: emailResult.sent === 'immediately' 
          ? 'Your ticket has been submitted successfully!' 
          : 'Your ticket has been queued and will be processed soon.',
        sent: emailResult.sent
      });
    } catch (error) {
      console.error('Support ticket error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Admin reply to user
  if (action === 'sendAdminReply') {
    try {
      const { ticketId, toEmail, resolutionCategory, message, authToken, userId } = body;

      if (!ticketId || !toEmail || !resolutionCategory || !message || !authToken || !userId) {
        return res.status(400).json({ error: 'Missing fields' });
      }

      // Validate admin/support role
      const session = await validateSessionAndFetchPlayerStats(
        supabase,
        authToken,
        userId,
        { select: 'role' }
      );

      if (!session.valid || !['admin', 'support'].includes(session.stats?.role)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const status = mapResolutionToStatus(resolutionCategory);

      // Send response email to the player
      const emailResult = await sendEmail({
        to: toEmail,
        subject: `Support Response #${ticketId}`,
        html: `
          <p>Hi,</p>
          <p>We reviewed your ticket <strong>#${ticketId}</strong>.</p>
          <p><strong>Resolution:</strong> ${resolutionCategory}</p>
          <p>${message.replace(/\n/g, '<br>')}</p>
          <p>If you have more questions, reply to this email and include the ticket ID in the subject.</p>
        `
      });

      if (!emailResult.success) {
        return res.status(500).json({ error: 'Failed to send email' });
      }

      // Update ticket status and notes (try ticket_code, then fallback to id)
      const updates = {
        status,
        resolution_category: resolutionCategory,
        resolution_notes: message,
        updated_at: new Date().toISOString()
      };

      const { error: updateErrorCode } = await supabase
        .from('support_tickets')
        .update(updates)
        .eq('ticket_code', ticketId);

      if (updateErrorCode) {
        console.warn('⚠️ Ticket update by ticket_code failed, trying by id:', updateErrorCode.message);

        const { error: updateErrorId } = await supabase
          .from('support_tickets')
          .update(updates)
          .eq('id', ticketId);

        if (updateErrorId) {
          console.error('❌ Error updating ticket after reply:', updateErrorId);
        }
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Admin reply error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Get queue status (admin only)
  if (action === 'getQueueStatus') {
    try {
      const { authToken, userId } = body;
      
      if (!authToken || !userId) {
        return res.status(400).json({ error: 'Missing auth' });
      }

      const session = await validateSessionAndFetchPlayerStats(supabase, authToken, userId, { select: 'role' });
      if (!session.valid || session.stats?.role !== 'admin') {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const status = await getQueueStatus();
      return res.status(200).json({ success: true, ...status });
    } catch (error) {
      console.error('Queue status error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(400).json({ error: 'Invalid action' });
}
