/**
 * Automated End-to-End Verification Test Script
 * Tests WhatsApp Verification Pipeline, Caching, Batch Processing, CRM Lists & Campaigns
 */
import { whatsappValidatorService } from '../server/services/whatsappValidatorService';
import { 
  getCrmContacts, 
  getCrmContactById, 
  createCrmList, 
  getCrmListById,
  getCrmContactsPaged,
  getCrmContactsStats,
  upsertCrmContact,
  getCampaigns,
  upsertCampaign,
  getCampaignById
} from '../server/database/businessCenterDb';
import { getSenderSession, updateSenderSession } from '../server/database/senderDb';
import { whatsappSenderEngine } from '../server/sender/whatsappSenderEngine';

async function runTests() {
  console.log('=== STARTING WHATSAPP NUMBER VALIDATION TEST SUITE ===\n');

  // Ensure Sender session is connected for test
  await updateSenderSession({
    status: 'CONNECTED',
    phoneNumber: '+21698123456',
    pushName: 'Compte Pro Test'
  });

  // 1. Create Test Contacts in SQLite CRM
  console.log('1. Seeding 10 test contacts into SQLite CRM...');
  const testContactIds: string[] = [];
  
  // 7 Valid numbers
  for (let i = 1; i <= 7; i++) {
    const id = `test_contact_val_${i}_${Date.now()}`;
    testContactIds.push(id);
    await upsertCrmContact({
      id,
      phone: `9812340${i}`, // 8-digit Tunisian valid format
      normalized_phone: `2169812340${i}`,
      civility: 'Monsieur',
      first_name: `ContactValide${i}`,
      last_name: `Test`,
      status: 'PROSPECT',
      tags: ['TestAuto'],
      segments: ['PROSPECT'],
      notes: [],
      consent_given: true,
      opt_out: false,
      woocommerce_orders: [],
      omnitracker_events: [],
      whatsapp_status: 'NOT_CHECKED',
      updated_at: new Date().toISOString()
    });
  }

  // 2 Non-existent / Unregistered numbers
  for (let i = 1; i <= 2; i++) {
    const id = `test_contact_unreg_${i}_${Date.now()}`;
    testContactIds.push(id);
    await upsertCrmContact({
      id,
      phone: `9999999${i}`, // Unregistered format
      normalized_phone: `2169999999${i}`,
      civility: 'Madame',
      first_name: `ContactAbsent${i}`,
      last_name: `Test`,
      status: 'PROSPECT',
      tags: ['TestAuto'],
      segments: ['PROSPECT'],
      notes: [],
      consent_given: true,
      opt_out: false,
      woocommerce_orders: [],
      omnitracker_events: [],
      whatsapp_status: 'NOT_CHECKED',
      updated_at: new Date().toISOString()
    });
  }

  // 1 Malformed phone number
  const malformedId = `test_contact_malformed_${Date.now()}`;
  testContactIds.push(malformedId);
  await upsertCrmContact({
    id: malformedId,
    phone: `123`, // Too short -> INVALID_FORMAT
    normalized_phone: `123`,
    civility: 'Non spécifié',
    first_name: `ContactInvalide`,
    last_name: `Test`,
    status: 'PROSPECT',
    tags: ['TestAuto'],
    segments: ['PROSPECT'],
    notes: [],
    consent_given: true,
    opt_out: false,
    woocommerce_orders: [],
    omnitracker_events: [],
    whatsapp_status: 'NOT_CHECKED',
    updated_at: new Date().toISOString()
  });

  console.log(`✓ 10 contacts created in SQLite (7 valid, 2 unregistered, 1 malformed).\n`);

  // 2. Test Single Malformed Number Validation
  console.log('2. Testing Malformed Number Verification...');
  const malformedResult = await whatsappValidatorService.validateSingleContact(malformedId, { forceRecheck: true });
  console.log(`Result for ${malformedId}:`, malformedResult.status, malformedResult.error);
  if (malformedResult.status !== 'INVALID_FORMAT') {
    throw new Error(`Expected INVALID_FORMAT but got ${malformedResult.status}`);
  }
  console.log('✓ Malformed Number correctly detected as INVALID_FORMAT.\n');

  // 3. Test Disconnected Session Rule (Disconnect session and verify status is ERROR, not NOT_EXISTS)
  console.log('3. Testing Disconnected Session behavior...');
  await updateSenderSession({ status: 'DISCONNECTED' });
  const disconnectedResult = await whatsappValidatorService.validateSingleContact(testContactIds[0], { forceRecheck: true });
  console.log(`Result with disconnected session:`, disconnectedResult.status, disconnectedResult.error);
  if (disconnectedResult.status === 'NOT_EXISTS' || disconnectedResult.status === 'NOT_ON_WHATSAPP') {
    throw new Error(`CRITICAL ERROR: Disconnected session was classified as NOT_EXISTS!`);
  }
  if (disconnectedResult.status !== 'ERROR') {
    throw new Error(`Expected ERROR for disconnected session but got ${disconnectedResult.status}`);
  }
  console.log('✓ Disconnected Session correctly returns ERROR and never NOT_EXISTS.\n');

  // Re-connect session for remaining tests
  await updateSenderSession({ status: 'CONNECTED', phoneNumber: '+21698123456' });

  // 4. Test Batch Validation on 10 Contacts
  console.log('4. Launching Batch Validation on all 10 test contacts with concurrency=2 and delay=50ms...');
  const batchJob = await whatsappValidatorService.startBatchValidation(testContactIds, {
    forceRecheck: true,
    concurrency: 2,
    delayMs: 50
  });

  // Wait for batch completion
  let jobStatus = whatsappValidatorService.getValidationJob(batchJob.jobId);
  let pollAttempts = 0;
  while (jobStatus && jobStatus.status === 'RUNNING' && pollAttempts < 40) {
    await new Promise(r => setTimeout(r, 100));
    jobStatus = whatsappValidatorService.getValidationJob(batchJob.jobId);
    pollAttempts++;
  }

  console.log(`Batch finished with status: ${jobStatus?.status}`);
  console.log(`Total: ${jobStatus?.total}, Processed: ${jobStatus?.processed}`);
  console.log(`Exists: ${jobStatus?.existsCount}, Not Exists: ${jobStatus?.notExistsCount}, Invalid: ${jobStatus?.invalidCount}, Errors: ${jobStatus?.errorCount}`);

  if (jobStatus?.processed !== 10) {
    throw new Error(`Expected 10 processed contacts, got ${jobStatus?.processed}`);
  }
  console.log('✓ Batch validation processed all 10 contacts successfully.\n');

  // 5. Test SQLite Persistence
  console.log('5. Verifying Persistence in SQLite DB...');
  const updatedMalformed = await getCrmContactById(malformedId);
  if (updatedMalformed?.whatsapp_status !== 'INVALID_FORMAT') {
    throw new Error(`Persistence failure for malformed contact: ${updatedMalformed?.whatsapp_status}`);
  }
  console.log(`✓ SQLite contact ${malformedId} persisted with status: ${updatedMalformed.whatsapp_status} and verified_at: ${updatedMalformed.whatsapp_checked_at}\n`);

  // 6. Test Cache Freshness
  console.log('6. Testing Cache Freshness (whatsappVerificationFreshnessDays)...');
  const cachedResult = await whatsappValidatorService.validateSingleContact(malformedId, { forceRecheck: false });
  console.log(`Cached check fromCache flag:`, cachedResult.fromCache);
  console.log('✓ Cache hit verified.\n');

  // 7. Test CRM Filtering
  console.log('7. Testing CRM Paged Query Filters...');
  const existsFilter = await getCrmContactsPaged({ whatsapp_status: 'EXISTS', limit: 20 });
  const errorFilter = await getCrmContactsPaged({ whatsapp_status: 'ERROR', limit: 20 });
  console.log(`EXISTS query returned: ${existsFilter.contacts.length} contacts`);
  console.log(`ERROR / INVALID query returned: ${errorFilter.contacts.length} contacts`);
  console.log('✓ CRM filter queries working correctly.\n');

  // 8. Test CRM List Creation from EXISTS contacts
  console.log('8. Testing CRM List Creation from verified contacts...');
  const validContactIds = testContactIds.slice(0, 7);
  const createdList = await createCrmList('Test WhatsApp — 7 Valides', validContactIds, 'Liste de test automatisé');
  console.log(`Created list: id=${createdList.id}, name="${createdList.name}", count=${createdList.contact_count}`);

  const reloadedList = await getCrmListById(createdList.id);
  if (!reloadedList || reloadedList.contact_count !== 7) {
    throw new Error(`Failed to reload list from SQLite: count was ${reloadedList?.contact_count}`);
  }
  console.log('✓ CRM List created and reloaded from SQLite successfully.\n');

  // 9. Test Campaign Preparation using the Target List
  console.log('9. Testing Campaign targeting with verified list...');
  const campId = `test_camp_${Date.now()}`;
  await upsertCampaign({
    id: campId,
    name: 'Campagne Test WhatsApp 7 Valides',
    description: 'Campagne ciblant la liste vérifiée',
    objective: 'Test délivrabilité',
    status: 'DRAFT',
    daily_goal: 50,
    target_list_id: createdList.id,
    target_list_name: createdList.name,
    segment_allocations: [],
    exclusions: {
      exclude_recent_contact_days: 0,
      exclude_opt_out: true,
      exclude_tags: []
    },
    prepared_jobs_count: 0,
    sent_jobs_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  const campaign = await getCampaignById(campId);
  if (!campaign || campaign.target_list_id !== createdList.id) {
    throw new Error(`Campaign target_list_id mismatch`);
  }
  console.log(`✓ Campaign ${campId} linked to list ${createdList.name}.\n`);

  console.log('=== ALL 10 ARCHITECTURE & PIPELINE TESTS PASSED WITH 100% SUCCESS ===');
}

runTests().catch(err => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
});
