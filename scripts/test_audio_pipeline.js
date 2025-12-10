const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const readline = require('readline');
const { TwilioBridgeService } = require('../features/voice-agent/services/realtime/TwilioBridgeService');

// Check arguments
let inputFile = process.argv[2];
const outputFile = process.argv[3] || 'output_gated.wav';

// Auto-generate default filename if not provided
if (!inputFile) {
  // If no args provided, suggest record mode
  inputFile = 'test_input.wav';
  // But wait, if we are in record mode, we don't want to default yet.
}

async function listAudioDevices() {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
    let stderr = '';
    
    p.stderr.on('data', d => stderr += d.toString());
    
    p.on('close', () => {
      // Parse stderr for audio devices
      const devices = [];
      const lines = stderr.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Look for lines ending in "(audio)"
        // Example: [dshow @ ...] "Microphone Array" (audio)
        if (line.trim().endsWith('(audio)')) {
          const match = line.match(/"([^"]+)"/);
          if (match && match[1]) {
            devices.push(match[1]);
          }
        }
      }
      resolve(devices);
    });
  });
}

async function recordAudio(filename) {
  console.log('🎤 Detecting audio devices...');
  const devices = await listAudioDevices();
  
  if (devices.length === 0) {
    throw new Error('No audio devices found. Please ensure a microphone is connected.');
  }
  
  const deviceName = devices[0];
  console.log(`🎤 Using audio device: "${deviceName}"`);
  console.log(`🔴 Recording to ${filename}... Press ENTER to stop.`);

  return new Promise((resolve, reject) => {
    // Start ffmpeg recording
    const p = spawn(ffmpegPath, [
      '-y',
      '-f', 'dshow',
      '-i', `audio=${deviceName}`,
      '-ac', '1', // Mono
      '-ar', '8000', // 8kHz
      filename
    ]);
    
    // Handle user input to stop
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('', () => {
      console.log('⏹️ Stopping recording...');
      // Kill ffmpeg gracefully
      p.kill('SIGINT'); // Send Ctrl+C
      
      // Force kill if it doesn't stop after 2s
      setTimeout(() => {
        if (!p.killed) p.kill();
      }, 2000);
      
      rl.close();
    });

    p.on('close', (code) => {
      console.log('✅ Recording saved.');
      resolve();
    });
    
    p.on('error', (err) => {
      reject(err);
    });
  });
}

async function generateTestFileIfNeeded(filePath) {
  if (fs.existsSync(filePath)) {
    console.log(`Using existing input file: ${filePath}`);
    return;
  }

  console.log(`Generating synthetic test audio: ${filePath}...`);
  console.log('Pattern: Silence (1s) -> Low Noise (1s) -> Tone (2s) -> Silence (1s)');
  
  const args = [
    '-y',
    '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono:d=1',
    '-f', 'lavfi', '-i', 'anoisesrc=r=8000:a=0.01:d=1',
    '-f', 'lavfi', '-i', 'sine=f=440:r=8000:d=2',
    '-filter_complex', '[0:a][1:a][2:a][0:a]concat=n=4:v=0:a=1[outa]',
    '-map', '[outa]',
    filePath
  ];

  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args);
    p.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Test audio generated successfully.');
        resolve();
      } else {
        reject(new Error(`FFmpeg failed to generate audio with code ${code}`));
      }
    });
  });
}

// Mock the RealtimeWebSocketService dependencies
const mockRealtimeWSService = {
  sessions: new Map(),
  capturedAudio: [],
  tenantContextManager: { setTenantContext: () => {}, getBusinessId: () => 'test-business' },
  stateManager: { updateUserInfo: () => {}, updateSession: () => {} },
  handleClientMessage: (session, msg) => {
    if (msg.type === 'audio' && msg.data) mockRealtimeWSService.capturedAudio.push(msg.data);
  },
  createSession: async () => {},
  closeSession: async () => {},
  popCaptured: () => {
    const audio = mockRealtimeWSService.capturedAudio;
    mockRealtimeWSService.capturedAudio = [];
    return audio;
  }
};

async function runPipeline() {
  // Handle recording logic
  if (process.argv.includes('--record')) {
    inputFile = 'recorded_input.wav';
    await recordAudio(inputFile);
  } else if (!fs.existsSync(inputFile) && inputFile === 'test_input.wav') {
    await generateTestFileIfNeeded(inputFile);
  } else if (!fs.existsSync(inputFile)) {
     console.log(`Error: Input file '${inputFile}' not found.`);
     console.log(`\nTo record from microphone, use: node scripts/test_audio_pipeline.js --record`);
     console.log(`To generate a synthetic test file, run without arguments: node scripts/test_audio_pipeline.js`);
     process.exit(1);
  }

  console.log(`\n🎧 Starting Audio Pipeline Test`);
  console.log(`Input: ${inputFile}`);
  console.log(`Output: ${outputFile}`);
  console.log(`----------------------------------------`);

  // Initialize Bridge
  const bridge = new TwilioBridgeService(mockRealtimeWSService);
  const callSid = 'test-call-sid';
  const sessionId = await bridge.start(callSid, {}, 'stream-sid', 'test-business');
  mockRealtimeWSService.sessions.set(sessionId, { sessionId });

  // 1. Start FFmpeg process to decode input to raw u-law 8000Hz
  const decoder = spawn(ffmpegPath, ['-i', inputFile, '-f', 'mulaw', '-ar', '8000', '-ac', '1', '-y', 'pipe:1']);

  // 2. Start FFmpeg process to encode output to WAV
  const encoder = spawn(ffmpegPath, ['-f', 'mulaw', '-ar', '8000', '-ac', '1', '-i', 'pipe:0', '-y', outputFile]);

  const CHUNK_SIZE = 160; 
  let buffer = Buffer.alloc(0);
  let totalFrames = 0;
  let passedFrames = 0;

  decoder.stdout.on('data', async (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= CHUNK_SIZE) {
      const frame = buffer.subarray(0, CHUNK_SIZE);
      buffer = buffer.subarray(CHUNK_SIZE);
      totalFrames++;

      await bridge.handleTwilioMedia(callSid, frame.toString('base64'));

      const captured = mockRealtimeWSService.popCaptured();
      if (captured && captured.length > 0) {
        passedFrames++;
        for (const cap of captured) encoder.stdin.write(Buffer.from(cap, 'base64'));
        process.stdout.write('█');
      } else {
        process.stdout.write('.');
      }
    }
  });

  decoder.on('close', async (code) => {
    console.log(`\n\n----------------------------------------`);
    console.log(`Decoding finished with code ${code}`);
    encoder.stdin.end();
  });

  encoder.on('close', (code) => {
    console.log(`Encoding finished with code ${code}`);
    console.log(`----------------------------------------`);
    console.log(`Total Frames: ${totalFrames}`);
    console.log(`Passed Frames: ${passedFrames}`);
    console.log(`Blocked Frames: ${totalFrames - passedFrames} (${totalFrames > 0 ? Math.round((1 - passedFrames/totalFrames)*100) : 0}%)`);
    console.log(`\nOutput saved to: ${outputFile}`);
    console.log(`You can now listen to this file to hear exactly what OpenAI would receive.`);
  });
}

runPipeline().catch(console.error);
