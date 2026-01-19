#!/usr/bin/env node

/**
 * Krisp Integration Test
 * 
 * This script verifies that Krisp SDK is properly installed and configured
 * Run this before deploying to ensure everything works
 */

const { KrispService } = require('../features/voice-agent/services/realtime/KrispService');

console.log('='.repeat(60));
console.log('Krisp Integration Test');
console.log('='.repeat(60));
console.log('');

// Test 1: KrispService initialization
console.log('Test 1: KrispService Initialization');
console.log('-'.repeat(60));

try {
  const krispService = new KrispService();
  const status = krispService.getStatus();
  
  console.log('✅ KrispService instantiated successfully');
  console.log('');
  console.log('Status:', JSON.stringify(status, null, 2));
  console.log('');
  
  if (!status.enabled) {
    console.log('⚠️  WARNING: Krisp is DISABLED');
    console.log('   Reason:', status.error || 'KRISP_ENABLED not set to true');
    console.log('');
    console.log('To enable Krisp, set these environment variables:');
    console.log('   KRISP_ENABLED=true');
    console.log('   KRISP_MODEL_PATH=/path/to/nc_model.kw');
    console.log('');
    process.exit(0);
  }
  
  if (!status.initialized) {
    console.log('❌ ERROR: Krisp failed to initialize');
    console.log('   Error:', status.error);
    console.log('');
    console.log('Troubleshooting:');
    console.log('   1. Check that KRISP_MODEL_PATH points to a valid file');
    console.log('   2. Verify file has read permissions');
    console.log('   3. Ensure model file is compatible with Krisp SDK version');
    console.log('');
    process.exit(1);
  }
  
  console.log('✅ Krisp initialized successfully');
  console.log('');
  
  // Test 2: Session creation
  console.log('Test 2: Session Creation');
  console.log('-'.repeat(60));
  
  const testSessionId = 'test-session-123';
  const sessionCreated = krispService.createSession(testSessionId);
  
  if (sessionCreated) {
    console.log('✅ Test session created successfully');
    console.log('');
    
    // Test 3: Audio processing
    console.log('Test 3: Audio Processing');
    console.log('-'.repeat(60));
    
    // Create a dummy PCM16 audio frame (20ms at 8kHz = 160 samples)
    const dummyAudio = Buffer.alloc(160 * 2); // 160 samples * 2 bytes per sample
    for (let i = 0; i < 160; i++) {
      // Fill with simple sine wave for testing
      dummyAudio.writeInt16LE(Math.sin(i / 10) * 1000, i * 2);
    }
    
    console.log('Processing dummy audio frame (160 samples)...');
    const processedAudio = krispService.processAudio(testSessionId, dummyAudio);
    
    if (processedAudio && processedAudio.length === dummyAudio.length) {
      console.log('✅ Audio processed successfully');
      console.log(`   Input size: ${dummyAudio.length} bytes`);
      console.log(`   Output size: ${processedAudio.length} bytes`);
      console.log('');
    } else {
      console.log('❌ ERROR: Audio processing failed or returned wrong size');
      console.log(`   Expected: ${dummyAudio.length} bytes`);
      console.log(`   Got: ${processedAudio ? processedAudio.length : 'null'} bytes`);
      console.log('');
      krispService.cleanup(testSessionId);
      krispService.destroy();
      process.exit(1);
    }
    
    // Test 4: Session cleanup
    console.log('Test 4: Session Cleanup');
    console.log('-'.repeat(60));
    
    krispService.cleanup(testSessionId);
    console.log('✅ Test session cleaned up');
    console.log('');
    
  } else {
    console.log('❌ ERROR: Failed to create test session');
    console.log('');
    krispService.destroy();
    process.exit(1);
  }
  
  // Cleanup
  krispService.destroy();
  
  // Summary
  console.log('='.repeat(60));
  console.log('✅ ALL TESTS PASSED');
  console.log('='.repeat(60));
  console.log('');
  console.log('Krisp is properly configured and ready to use!');
  console.log('');
  console.log('Next steps:');
  console.log('1. Deploy to production');
  console.log('2. Make test call in noisy environment');
  console.log('3. Verify background noise is suppressed');
  console.log('4. Monitor logs for any Krisp-related warnings');
  console.log('');
  
} catch (error) {
  console.log('❌ FATAL ERROR:', error.message);
  console.log('');
  console.log('Stack trace:');
  console.log(error.stack);
  console.log('');
  process.exit(1);
}
