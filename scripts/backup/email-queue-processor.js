// ============================================================
// EMAIL QUEUE PROCESSOR - DAILY JOB (00:00)
// ============================================================
// This script processes pending email queue every day at midnight
// Use with cron job or scheduler (node-cron, node-schedule, etc)

import cron from 'node-cron';
import { processEmailQueue, resetEmailCounter } from '../api/_support.js';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================
// CONFIGURATION
// ============================================================

const CRON_SCHEDULE = '0 0 * * *'; // Every day at 00:00 (midnight)
const TIMEZONE = 'America/Sao_Paulo';

// ============================================================
// PROCESSING FUNCTION
// ============================================================

async function runDailyEmailJob() {
  console.log('\n==============================================');
  console.log('🔄 DAILY EMAIL JOB STARTED');
  console.log(`📅 ${new Date().toLocaleString('pt-BR', { timeZone: TIMEZONE })}`);
  console.log('==============================================\n');
  
  try {
    // Process pending email queue
    const result = await processEmailQueue();
    
    console.log('\n==============================================');
    console.log('✅ DAILY EMAIL JOB COMPLETED');
    console.log(`📊 Processed: ${result.processed} emails`);
    console.log(`✅ Success: ${result.success} emails`);
    console.log(`❌ Failed: ${result.failed} emails`);
    console.log('==============================================\n');
    
    return result;
    
  } catch (error) {
    console.error('\n==============================================');
    console.error('💥 DAILY EMAIL JOB FAILED');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('==============================================\n');
    
    return { processed: 0, success: 0, failed: 0, error: error.message };
  }
}

// ============================================================
// CRON JOB SCHEDULING
// ============================================================

function startEmailQueueProcessor() {
  console.log('🚀 Starting Email Queue Processor...');
  console.log(`⏰ Scheduled to run daily at 00:00 (${TIMEZONE})`);
  console.log(`📋 Cron expression: ${CRON_SCHEDULE}\n`);
  
  // Schedule daily job
  const job = cron.schedule(CRON_SCHEDULE, runDailyEmailJob, {
    scheduled: true,
    timezone: TIMEZONE
  });
  
  console.log('✅ Email Queue Processor started successfully');
  console.log('⏳ Waiting for scheduled time...\n');
  
  return job;
}

// ============================================================
// MANUAL EXECUTION (FOR TESTING)
// ============================================================

async function runManually() {
  console.log('🧪 MANUAL EXECUTION MODE\n');
  await runDailyEmailJob();
  process.exit(0);
}

// ============================================================
// INITIALIZATION
// ============================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  // Check if has --manual argument for manual execution
  if (process.argv.includes('--manual')) {
    runManually();
  } else {
    // Start scheduler
    const job = startEmailQueueProcessor();
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('\n⚠️ SIGTERM received, stopping gracefully...');
      job.stop();
      process.exit(0);
    });
    
    process.on('SIGINT', () => {
      console.log('\n⚠️ SIGINT received, stopping gracefully...');
      job.stop();
      process.exit(0);
    });
  }
}

// ============================================================
// EXPORTS
// ============================================================

export { runDailyEmailJob, startEmailQueueProcessor };
export default startEmailQueueProcessor;
